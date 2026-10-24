import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { encode as encodeBlurhash } from 'blurhash';
import { v5 as uuidv5 } from 'uuid';
import { AssetStatus, AssetType, type Prisma, type PrismaClient } from '@prisma/client';
import { IMAGE_VARIANTS } from '../../../../libs/shared/common/src/asset-variants';
import type { SeedStorageDriver } from './storage';
import type { Translatable } from './translatable';

/**
 * Storage-path prefix for every fixture-catalogue-seed-owned asset binary.
 * Mirror in `lib/idempotency.ts` for the cleanup scan.
 */
export const FIXTURE_CATALOGUE_ASSET_PREFIX = 'assets/seed-fixture-catalogue/';

/**
 * UUID namespace for deriving stable seed Asset.id values from a content
 * hash. Random-but-fixed (do not change without a migration). Pairs with
 * the storage-path prefix above so a re-run on the same source binaries
 * produces the same `Asset.id`, eliminating row churn across reseeds.
 */
const SEED_ASSET_NAMESPACE = '8b9d7a2e-1c4f-4e6b-9a3d-5f7c8e1d2b3a';

function deriveAssetId(storageId: string): string {
  return uuidv5(storageId, SEED_ASSET_NAMESPACE);
}

interface VariantResult {
  url: string;
  storagePath: string;
  width: number;
  height: number;
  size: number;
}

type CachedVariants = Record<string, { webp: VariantResult; avif: VariantResult }>;

function rebaseVariants(variants: CachedVariants, storage: SeedStorageDriver): CachedVariants {
  const rebase = (v: VariantResult): VariantResult => ({
    ...v,
    url: storage.urlFor(v.storagePath),
  });
  return Object.fromEntries(
    Object.entries(variants).map(([name, v]) => [
      name,
      { webp: rebase(v.webp), avif: rebase(v.avif) },
    ]),
  );
}

/**
 * Synchronous mirror of the production
 * `apps/api/src/modules/assets/processors/image-processing.processor.ts`.
 *
 * Pipeline parity is enforced by `__tests__/pipeline-parity.spec.ts` which
 * runs the production processor and this runner against the same input PNG
 * and asserts identical Asset.variants shape.
 *
 * Inputs: source PNG path. Outputs: 4 variants × 2 formats written to disk
 * (post-AV1 — `original` was dropped from `IMAGE_VARIANTS`) + an `Asset`
 * row created with status=READY and variants/blurhash populated.
 */
export async function ingestImage(args: {
  prisma: PrismaClient;
  storage: SeedStorageDriver;
  sourcePath: string;
  alt: Translatable;
}): Promise<{ assetId: string }> {
  const rawBuffer = await fs.readFile(args.sourcePath);
  const sourceMime = detectImageMime(rawBuffer);
  // Storage key uses a content-hash directory (stable across reseeds) so the
  // S3 driver's head-then-skip path can avoid re-uploading the same image
  // 9 times per seed run (1 original + 4 variants × 2 formats post-AV1 —
  // `original` was dropped from IMAGE_VARIANTS). The DB Asset.id stays a
  // fresh UUID — DB id and storage path are independent.
  const storageId = createHash('sha256').update(rawBuffer).digest('hex').slice(0, 32);

  const originalExt = mimeToExtension(sourceMime);
  const originalKey = `${FIXTURE_CATALOGUE_ASSET_PREFIX}${storageId}/original.${originalExt}`;
  // Sidecar lives under the PRIVATE prefix because it indexes the
  // original storage paths + content metadata. A public sidecar would
  // map content-hash directories to their original keys for any crawler
  // (security review AV5 finding #2).
  const cacheKey = `private/${FIXTURE_CATALOGUE_ASSET_PREFIX}${storageId}/variants.json`;
  const largeWebpKey = `${FIXTURE_CATALOGUE_ASSET_PREFIX}${storageId}/large.webp`;
  const retainOriginals = (process.env.RETAIN_ORIGINALS ?? 'false').toLowerCase() === 'true';

  // Idempotence short-circuit #1 — DB hit: a prior run on this DB already
  // ingested this exact image. Match on the canonical large-webp variant
  // path (post-AV5 the seed plants `Asset.storagePath = <large.webp>` per
  // spec §A2; pre-AV5 rows pointed at the original — matching on either
  // path keeps the short-circuit working through the AV5 cutover.
  const existing = await args.prisma.asset.findFirst({
    where: { OR: [{ storagePath: largeWebpKey }, { storagePath: originalKey }] },
    select: { id: true, storagePath: true, url: true, variants: true },
  });
  if (existing) {
    // Asset rows survive reseeds, so a row written under another uploads base
    // (dev :53000 vs e2e :53001) is moved onto the current one.
    const currentUrl = args.storage.urlFor(existing.storagePath);
    if (existing.url !== currentUrl) {
      await args.prisma.asset.update({
        where: { id: existing.id },
        data: {
          url: currentUrl,
          variants: rebaseVariants(
            existing.variants as unknown as CachedVariants,
            args.storage,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return { assetId: existing.id };
  }

  // Idempotence short-circuit #2 — storage cache hit: the e2e pipeline wipes
  // the DB between runs but the local `uploads/` dir survives. A prior run
  // wrote a `variants.json` sidecar next to the binaries; re-use the cached
  // variants blob + blurhash + sizing metadata to skip the entire sharp pass
  // (10 resizes × format encoders is the dominant cost when reseeding an
  // unchanged dataset).
  //
  // AV4 staleness guard: the AV1 pipeline dropped `original` from
  // IMAGE_VARIANTS. Cached sidecars written by the pre-AV1 seed contain an
  // `original` key that causes `imageAssetVariantsSchema.strict()` to reject
  // the resolved variants, silently preventing assetUrl/assetVariants from
  // hydrating in section responses. Discard caches that carry `original` so
  // the seed re-runs the sharp pass and writes a clean sidecar.
  //
  // AV5 staleness guard: pre-AV5 caches lack `largeStoragePath` /
  // `largeUrl` / `originalIsPrivate`. They also recorded the original
  // storagePath under the public `assets/seed-fixture-catalogue/...` prefix,
  // violating spec §3.5. Discard those so the seed re-uploads the
  // original to the private prefix and writes a variant-canonical row.
  const cached = await tryReadVariantsCache(args.storage, cacheKey);
  const cachedIsStaleVariants =
    cached !== null && 'original' in (cached.variants as Record<string, unknown>);
  const cachedIsStaleAv5 =
    cached !== null && (cached.largeStoragePath === undefined || cached.largeUrl === undefined);
  // RETAIN flip guard: if the cache was written with RETAIN=false, the
  // private original was deleted post-write. A reseed with RETAIN=true now
  // would plant `Asset.originalStoragePath = <deleted-key>` and the admin
  // signed-URL endpoint would 404. Force a fresh upload in that case.
  const cachedIsStaleRetainFlip =
    cached !== null && retainOriginals === true && cached.retainedAtCacheTime !== true;
  if (cached && !cachedIsStaleVariants && !cachedIsStaleAv5 && !cachedIsStaleRetainFlip) {
    // Both fields are non-undefined post-AV5 by the staleness check above.
    const cachedLargeStoragePath = cached.largeStoragePath as string;
    // The sidecar outlives the uploads base it was written under (dev :53000
    // vs e2e :53001), so its URLs are rebuilt from the storage paths.
    const variants = rebaseVariants(cached.variants, args.storage);
    const reuseId = deriveAssetId(storageId);
    let originalStoragePath: string | null = cached.originalStoragePath;
    if (!retainOriginals) {
      await args.storage.delete(cached.originalStoragePath);
      originalStoragePath = null;
    }
    await args.prisma.asset.create({
      data: {
        id: reuseId,
        alt: {
          default: args.alt.default,
          en: args.alt.en,
          fr: args.alt.fr,
        } as unknown as Prisma.InputJsonValue,
        type: AssetType.IMAGE,
        mimeType: cached.mimeType,
        fileSize: cached.fileSize,
        width: cached.width,
        height: cached.height,
        blurhash: cached.blurhash,
        status: AssetStatus.READY,
        variants: variants as unknown as Prisma.InputJsonValue,
        storagePath: cachedLargeStoragePath,
        url: args.storage.urlFor(cachedLargeStoragePath),
        originalStoragePath,
      },
    });
    return { assetId: reuseId };
  }

  const assetId = deriveAssetId(storageId);

  // 1. Save the original under the PRIVATE prefix:
  // `private/assets/seed-fixture-catalogue/<storageId>/original.<ext>`.
  // Constitution §3.5 + spec §3 require originals never to be
  // served to public clients. The driver's visibility split keeps the
  // bytes out of the public CDN-served root (S3: no `public-read` ACL +
  // `private/` key prefix; local: `${uploadsRoot}-private/` directory).
  const original = await args.storage.save(rawBuffer, originalKey, { visibility: 'private' });

  // 2. Original metadata for the Asset row.
  const originalMeta = await sharp(rawBuffer).metadata();
  const originalWidth = originalMeta.width ?? 0;
  const originalHeight = originalMeta.height ?? 0;

  // 3. Blurhash from a 32×32 raw RGBA thumbnail (matches processor
  // `generateBlurhash` lines 101-109).
  const blurhash = await generateBlurhash(rawBuffer);

  // 4. Per-variant × format processing.
  const variants: Record<string, { webp: VariantResult; avif: VariantResult }> = {};
  for (const variant of IMAGE_VARIANTS) {
    const resized =
      variant.width !== null
        ? sharp(rawBuffer).rotate().resize(variant.width, undefined, { withoutEnlargement: true })
        : sharp(rawBuffer).rotate();

    const [webpResult, avifResult] = await Promise.all([
      processFormat({
        pipeline: resized.clone(),
        format: 'webp',
        storageId,
        variantName: variant.name,
        storage: args.storage,
      }),
      processFormat({
        pipeline: resized.clone(),
        format: 'avif',
        storageId,
        variantName: variant.name,
        storage: args.storage,
      }),
    ]);

    variants[variant.name] = { webp: webpResult, avif: avifResult };
  }

  // 5. Asset row — variant-canonical per spec §A2.
  // `Asset.url` + `Asset.storagePath` point at the canonical large.webp
  // variant so direct row consumers (legacy fallback path before the
  // resolver lookup) see a public CDN URL, never an original key.
  // `Asset.originalStoragePath` carries the private original path so
  // the admin "Download original" signed-URL endpoint works.
  const largeWebp = variants.large?.webp;
  if (!largeWebp) {
    throw new Error(
      `seed image-pipeline: variants.large.webp missing — IMAGE_VARIANTS regression for asset ${assetId}`,
    );
  }
  let originalStoragePath: string | null = original.storagePath;
  if (!retainOriginals) {
    // RETAIN_ORIGINALS=false (production default per spec §6) — delete the
    // private original after variant verification. Mirrors the production
    // `image-processing.processor.ts` `maybeDeleteOriginal` step.
    await args.storage.delete(original.storagePath);
    originalStoragePath = null;
  }
  await args.prisma.asset.create({
    data: {
      id: assetId,
      // Clean Translatable JSONB — no boolean discriminator. Idempotence
      // marker lives on `storagePath` prefix, not on `alt`.
      alt: {
        default: args.alt.default,
        en: args.alt.en,
        fr: args.alt.fr,
      } as unknown as Prisma.InputJsonValue,
      type: AssetType.IMAGE,
      mimeType: sourceMime,
      fileSize: rawBuffer.byteLength,
      width: originalWidth,
      height: originalHeight,
      blurhash,
      status: AssetStatus.READY,
      variants: variants as unknown as Prisma.InputJsonValue,
      storagePath: largeWebp.storagePath,
      url: largeWebp.url,
      originalStoragePath,
    },
  });

  // 6. Persist the variants sidecar so the next reseed can hit the
  // storage-cache short-circuit and skip the sharp pass entirely.
  // Written to the PRIVATE prefix per AV5 security review — a public
  // sidecar would map content-hash directories to original keys + asset
  // metadata for any crawler. The `cacheKey` constant at line 70 carries
  // the `private/` prefix; passing `visibility: 'private'` here is
  // redundant defense-in-depth so the seed S3 driver does not need to
  // detect the prefix to route correctly.
  const cachePayload: VariantsCachePayload = {
    mimeType: sourceMime,
    fileSize: rawBuffer.byteLength,
    width: originalWidth,
    height: originalHeight,
    blurhash,
    originalStoragePath: original.storagePath,
    originalUrl: original.url,
    largeStoragePath: largeWebp.storagePath,
    largeUrl: largeWebp.url,
    retainedAtCacheTime: retainOriginals,
    variants,
  };
  await args.storage.save(Buffer.from(JSON.stringify(cachePayload)), cacheKey, {
    visibility: 'private',
  });

  return { assetId };
}

interface VariantsCachePayload {
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  blurhash: string;
  /** Private prefix path of the source original (post-AV5). */
  originalStoragePath: string;
  /** Empty post-AV5 (originals have no public URL); kept for back-compat shape. */
  originalUrl: string;
  /** Canonical large.webp variant storagePath — populates `Asset.storagePath`. */
  largeStoragePath?: string;
  /** Canonical large.webp variant URL — populates `Asset.url`. */
  largeUrl?: string;
  /**
   * Whether `RETAIN_ORIGINALS=true` was set when this cache was written.
   * Post-AV5 caches set this. Pre-AV5 caches don't, which is treated as
   * "unknown / not retained" by the staleness check.
   */
  retainedAtCacheTime?: boolean;
  variants: Record<string, { webp: VariantResult; avif: VariantResult }>;
}

async function tryReadVariantsCache(
  storage: SeedStorageDriver,
  key: string,
): Promise<VariantsCachePayload | null> {
  try {
    const buffer = await storage.read(key);
    return JSON.parse(buffer.toString('utf8')) as VariantsCachePayload;
  } catch {
    // ENOENT / NoSuchKey / parse error — fall through to a fresh sharp pass.
    return null;
  }
}

async function processFormat(args: {
  pipeline: sharp.Sharp;
  format: 'webp' | 'avif';
  storageId: string;
  variantName: string;
  storage: SeedStorageDriver;
}): Promise<VariantResult> {
  const { data, info } = await args.pipeline
    .toFormat(args.format, { quality: 80 })
    .toBuffer({ resolveWithObject: true });

  const filename = `${FIXTURE_CATALOGUE_ASSET_PREFIX}${args.storageId}/${args.variantName}.${args.format}`;
  const { url, storagePath } = await args.storage.save(data, filename);
  return { url, storagePath, width: info.width, height: info.height, size: info.size };
}

async function generateBlurhash(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer)
    .resize(32, 32, { fit: 'inside' })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  return encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

function detectImageMime(buf: Buffer): string {
  if (buf.length < 12) throw new Error('Image buffer too short to detect MIME type');
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return 'image/png';
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return 'image/webp';
  throw new Error('Unsupported source image type — only PNG / JPEG / WebP accepted');
}

function mimeToExtension(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}
