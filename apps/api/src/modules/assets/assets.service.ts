import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { AssetStatus, AssetType } from '@prisma/client';
import { pickVariantUrl, type AssetIntent, type PublicVariantUrl } from '@common/asset-variants';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ReturnsService } from '../returns/returns.service';
import { StorefrontConfigService } from '../storefront-config/storefront-config.service';
import {
  ADMIN_ORIGINAL_URL_TTL_SECONDS,
  ALLOWED_MIME_TYPES,
  IMAGE_PROCESSING_QUEUE,
  STORAGE_DRIVER,
  VIDEO_PROCESSING_QUEUE,
} from './assets.constants';
import {
  ASSET_REFERENCED_ERROR_CODE,
  type AssetReferenceKind,
  type AssetReferenceRow,
  type AssetReferences,
} from './assets.types';
import type { StorageDriver } from './storage/storage-driver.interface';
import type {
  ImageProcessingJobPayload,
  VideoProcessingJobPayload,
} from './interfaces/asset-job.interface';

export type { PublicVariantUrl };

// ── Magic bytes per MIME type ──────────────────────────────────────────────────

/**
 * Inspects the first bytes of a buffer to detect the actual MIME type.
 * Returns null when no known signature matches.
 */
function detectMimeFromMagicBytes(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
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

  // WebP: RIFF????WEBP
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

  // WebM: 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';

  // ISO Base Media (AVIF / MP4): offset 4–7 = "ftyp"
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii');
    const avifBrands = new Set(['avif', 'avis', 'mif1', 'msf1']);
    const mp4Brands = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);
    if (avifBrands.has(brand)) return 'image/avif';
    if (mp4Brands.has(brand)) return 'video/mp4';
  }

  return null;
}

function mimeToAssetType(mimeType: string): AssetType {
  if (mimeType.startsWith('image/')) return AssetType.IMAGE;
  if (mimeType.startsWith('video/')) return AssetType.VIDEO;
  if (mimeType.startsWith('audio/')) return AssetType.AUDIO;
  return AssetType.DOCUMENT;
}

function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return map[mimeType] ?? 'bin';
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly maxSizeBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @InjectQueue(IMAGE_PROCESSING_QUEUE) private readonly imageQueue: Queue,
    @InjectQueue(VIDEO_PROCESSING_QUEUE) private readonly videoQueue: Queue,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly reviews: ReviewsService,
    private readonly returns: ReturnsService,
    @Inject(forwardRef(() => StorefrontConfigService))
    private readonly storefrontConfig: StorefrontConfigService,
  ) {
    const maxMb = this.config.get<number>('MAX_ASSET_SIZE_MB', 10);
    this.maxSizeBytes = maxMb * 1024 * 1024;
  }

  async upload(file: Express.Multer.File) {
    this.validateFile(file);

    const id = uuidv4();
    const ext = mimeToExtension(file.mimetype);
    const rawFilename = `assets/${id}/original.${ext}`;

    // AV1 — original written to PRIVATE storage. The processor reads from
    // private, generates variants, writes them to public, then sets the
    // canonical url + storagePath fields and (env-gated) deletes the
    // original. Until processor flips the row, url + storagePath are blank.
    const { storagePath: originalStoragePath } = await this.storage.save(file.buffer, rawFilename, {
      visibility: 'private',
    });
    const assetType = mimeToAssetType(file.mimetype);

    // AV1 nit #2 / AV3 — strip `originalStoragePath` from the wire payload
    // via an explicit `select`. The field is private storage metadata; the
    // admin "Download original" flow goes through the dedicated signed-URL
    // endpoint instead. Admin Zod schema (AV3.11) tolerates the field but
    // we no longer ship it in the response body.
    const asset = await this.prisma.asset.create({
      data: {
        id,
        type: assetType,
        mimeType: file.mimetype,
        fileSize: file.size,
        status: AssetStatus.PROCESSING,
        storagePath: '',
        url: '',
        originalStoragePath,
      },
      select: {
        id: true,
        type: true,
        mimeType: true,
        fileSize: true,
        status: true,
        storagePath: true,
        url: true,
        alt: true,
        width: true,
        height: true,
        blurhash: true,
        variants: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (assetType === AssetType.IMAGE) {
      const payload: ImageProcessingJobPayload = {
        assetId: id,
        storagePath: originalStoragePath,
        mimeType: file.mimetype,
      };
      await this.imageQueue.add('process', payload);
      this.logger.log(`Queued image processing job for asset ${id}`);
    } else if (assetType === AssetType.VIDEO) {
      // AV2 — video uploads are now accepted (the AV1 rejection guard is
      // gone). Enqueue against the video queue so the FFmpeg processor
      // transcodes the renditions + extracts the poster frame, then flips
      // the row to READY.
      const payload: VideoProcessingJobPayload = {
        assetId: id,
        storagePath: originalStoragePath,
        mimeType: file.mimetype,
      };
      await this.videoQueue.add('process', payload);
      this.logger.log(`Queued video processing job for asset ${id}`);
    }

    return asset;
  }

  // ── Admin reads ────────────────────────────────────────────────────────────

  async list(query: {
    page?: number;
    pageSize?: number;
    type?: AssetType;
    status?: AssetStatus;
    from?: string;
    to?: string;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Record<string, unknown> = {};
    if (query.type !== undefined) where.type = query.type;
    if (query.status !== undefined) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    // AV3 — explicit `select` excludes `originalStoragePath` from the wire
    // payload. Detail responses (`findOne`) keep the field because the
    // admin "Download original" disabled-state gate needs it; list
    // responses do not need it and should not leak the private storage
    // path. Mirrors the upload-response strip pattern at `:155-186`.
    const [data, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          mimeType: true,
          fileSize: true,
          status: true,
          storagePath: true,
          url: true,
          alt: true,
          width: true,
          height: true,
          blurhash: true,
          variants: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.asset.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total } };
  }

  /**
   * Canonical-variant resolver — thin wrapper over the pure helper at
   * `@common/asset-variants` (`pickVariantUrl`). Kept as a service method
   * so the assets-module API surface stays cohesive; consumers in any
   * module may either inject `AssetsService` or import the pure helper
   * directly. See `agent_docs/assets-pipeline.md` §1.
   */
  publicVariantUrl(
    asset: { id: string; status: AssetStatus; variants: unknown },
    intent: AssetIntent,
  ): PublicVariantUrl {
    return pickVariantUrl(asset, intent);
  }

  /**
   * Bulk variant lookup — replaces the legacy `getUrlsByIds`. Used by
   * `StorefrontConfigService.getSections` and any other projection that
   * needs N variant URLs in a single round-trip. Ids absent from the
   * database, or whose asset is not READY, are omitted from the returned
   * Map (caller decides per-surface fallback — usually a brand placeholder).
   */
  async publicProjection(
    ids: readonly string[],
    intent: AssetIntent,
  ): Promise<Map<string, PublicVariantUrl>> {
    if (ids.length === 0) return new Map();
    const distinct = [...new Set(ids)];
    const rows = await this.prisma.asset.findMany({
      where: { id: { in: distinct } },
      select: { id: true, status: true, variants: true },
    });
    const out = new Map<string, PublicVariantUrl>();
    for (const row of rows) {
      try {
        out.set(row.id, pickVariantUrl(row, intent));
      } catch {
        // PROCESSING / FAILED / VariantMissing — caller falls back per surface.
      }
    }
    return out;
  }

  /**
   * AV1 — admin signed-URL endpoint. Returns a short-TTL presigned URL
   * (5 min) for the asset's private original. Used by admin re-process /
   * audit flows; never bound to a preview `[src]`. 404 when the original
   * has been deleted post-variant-verification (`originalStoragePath`
   * NULL) or when the asset row does not exist.
   */
  async getOriginalUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true, status: true, originalStoragePath: true },
    });
    if (!asset) {
      throw new NotFoundException(`Asset "${id}" not found`);
    }
    // AV1 nit #4 / AV3 — deny PENDING (the upload row exists but the
    // original buffer has not been persisted yet, so signing the path
    // would yield a 404 against the storage driver). READY / PROCESSING /
    // FAILED rows all have a populated original until the post-cutover
    // delete runs, so admin operators can audit / re-process from any
    // non-PENDING state. §3.5 deny-by-default — explicit allowlist.
    if (asset.status === AssetStatus.PENDING) {
      throw new NotFoundException(`Asset "${id}" is PENDING — original not yet persisted`);
    }
    if (!asset.originalStoragePath) {
      throw new NotFoundException(`Asset "${id}" has no original on file (post-deletion)`);
    }
    const url = await this.storage.signUrl(
      asset.originalStoragePath,
      ADMIN_ORIGINAL_URL_TTL_SECONDS,
    );
    const expiresAt = new Date(Date.now() + ADMIN_ORIGINAL_URL_TTL_SECONDS * 1000).toISOString();
    return { url, expiresAt };
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new BadRequestException(`Asset "${id}" not found`);
    }
    // Lightweight usage count for the asset detail header. Full reference
    // listing — with click-through to each owning entity — lives at
    // `getReferences()` below.
    const [productAssets, reviewAssets, returnAssets, categories] = await Promise.all([
      this.prisma.productAsset.count({ where: { assetId: id } }),
      this.prisma.reviewAsset.count({ where: { assetId: id } }),
      this.prisma.returnAsset.count({ where: { assetId: id } }),
      this.prisma.category.count({ where: { imageId: id } }),
    ]);
    return {
      ...asset,
      usage: {
        products: productAssets,
        reviews: reviewAssets,
        returns: returnAssets,
        categories,
        total: productAssets + reviewAssets + returnAssets + categories,
      },
    };
  }

  async remove(id: string): Promise<void> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!asset) {
      throw new BadRequestException(`Asset "${id}" not found`);
    }
    // DR-07 — block hard-delete while any reference exists. The
    // references endpoint (WS2) is the operator's cleanup tool. The
    // Prisma onDelete: Restrict rules stay as defence-in-depth — they
    // close any TOCTOU window between the references read below and
    // the delete (a concurrent attach would surface as P2003).
    const references = await this.getReferences(id);
    if (references.total > 0) {
      throw this.referencedConflict(references);
    }
    try {
      await this.prisma.asset.delete({ where: { id } });
    } catch (err: unknown) {
      // Race: a reference appeared between the check above and the
      // DB-level FK constraint. Re-aggregate and surface the structured
      // 409 instead of leaking the raw P2003.
      if (this.isForeignKeyRestrict(err)) {
        const after = await this.getReferences(id);
        throw this.referencedConflict(after);
      }
      throw err;
    }
    this.logger.log(`delete: assetId=${id}`);
  }

  private referencedConflict(references: AssetReferences): ConflictException {
    return new ConflictException({
      error: {
        code: ASSET_REFERENCED_ERROR_CODE,
        message: `Asset has ${references.total} reference(s). Remove them before deleting.`,
        details: { references },
      },
    });
  }

  private isForeignKeyRestrict(err: unknown): boolean {
    return Boolean(
      err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2003',
    );
  }

  // ── Asset references aggregation (S18 — DR-07) ────────────────────────────

  /**
   * Aggregates every place the given asset is in use. Calls owning-module
   * services per constitution §3.1 modular isolation — never reaches into
   * join tables directly. Six reference kinds are populated: five FK
   * (product / variant / review / return / category) and one JSONB
   * (`StorefrontSection.config` per DR-04 + DR-07; the per-type schemas in
   * `storefront-config/dto/configs/` declare which `assetId` paths are
   * scanned).
   *
   * The returned `total` is the sum across all populated arrays. When
   * `filters.type` is supplied, only that kind's array is populated and
   * `total` reflects the filtered count.
   */
  async getReferences(
    assetId: string,
    filters: { type?: AssetReferenceKind; page?: number; pageSize?: number } = {},
  ): Promise<AssetReferences> {
    const want = (k: AssetReferenceKind): boolean => !filters.type || filters.type === k;

    const [products, variants, reviews, returns, categories, sections] = await Promise.all([
      want('product') ? this.products.findByAssetId(assetId) : Promise.resolve([]),
      want('variant') ? this.products.findVariantsByDownloadAssetId(assetId) : Promise.resolve([]),
      want('review') ? this.reviews.findByAssetId(assetId) : Promise.resolve([]),
      want('return') ? this.returns.findByAssetId(assetId) : Promise.resolve([]),
      want('category') ? this.categories.findByImageId(assetId) : Promise.resolve([]),
      want('section') ? this.storefrontConfig.findSectionsByAssetId(assetId) : Promise.resolve([]),
    ]);

    const productRows: AssetReferenceRow[] = products.map((p) => ({
      kind: 'product',
      id: p.id,
      label: p.slug,
      route: `/products/${p.id}/edit`,
    }));
    const variantRows: AssetReferenceRow[] = variants.map((v) => ({
      kind: 'variant',
      id: v.id,
      label: v.productSlug ? `${v.productSlug} · ${v.sku}` : v.sku,
      route: `/products/${v.productId}/edit`,
    }));
    const reviewRows: AssetReferenceRow[] = reviews.map((r) => ({
      kind: 'review',
      id: r.id,
      label: r.customerName ? `${r.productSlug} · ${r.customerName}` : r.productSlug || r.id,
      route: `/reviews/${r.id}`,
    }));
    const returnRows: AssetReferenceRow[] = returns.map((r) => ({
      kind: 'return',
      id: r.id,
      label: r.customerName ? `${r.returnNumber} · ${r.customerName}` : r.returnNumber,
      route: `/returns/${r.id}`,
    }));
    const categoryRows: AssetReferenceRow[] = categories.map((c) => ({
      kind: 'category',
      id: c.id,
      label: c.slug,
      route: `/categories/${c.id}`,
    }));
    const sectionRows: AssetReferenceRow[] = sections.map((s) => ({
      kind: 'section',
      id: s.id,
      label: `${s.pageSlug} · ${s.type.toLowerCase().replace(/_/g, ' ')}`,
      route: `/storefront/sections/${s.id}/edit`,
    }));

    const total =
      productRows.length +
      variantRows.length +
      reviewRows.length +
      returnRows.length +
      categoryRows.length +
      sectionRows.length;

    return {
      products: productRows,
      variants: variantRows,
      reviews: reviewRows,
      returns: returnRows,
      categories: categoryRows,
      sections: sectionRows,
      total,
    };
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  private validateFile(file: Express.Multer.File): void {
    if (!file?.buffer || file.size === 0) {
      throw new BadRequestException('No file provided');
    }

    if (file.size > this.maxSizeBytes) {
      const maxMb = Math.round(this.maxSizeBytes / 1024 / 1024);
      throw new BadRequestException(`File exceeds maximum allowed size of ${maxMb}MB`);
    }

    // 1. Declared MIME type must be on the allowlist.
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}. ` +
          'Allowed: image/jpeg, image/png, image/webp, image/avif, video/mp4, video/webm',
      );
    }

    // 2. Magic bytes must match the declared MIME type.
    const detected = detectMimeFromMagicBytes(file.buffer);
    if (detected !== file.mimetype) {
      throw new BadRequestException(
        'File content does not match declared MIME type (magic byte mismatch)',
      );
    }
  }
}
