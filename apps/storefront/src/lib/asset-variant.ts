import type { PictureSource } from '../app/ui/picture.component';

/**
 * Storefront-side mirror of `libs/shared/common/src/asset-variants/resolver.ts`.
 * Pure function over the storefront `Asset.variants` JSONB shape (received
 * unchanged from the API). The storefront cannot import the backend module
 * directly because the storefront tsconfig does not wire `@common/*` paths,
 * and pulling NestJS deps into the SSR/SSG bundle is out of scope. This module
 * stays bit-for-bit aligned with the backend resolver via the parity unit test
 * in `asset-variant.spec.ts`. See `agent_docs/assets-pipeline.md` §1 + §2.
 */

export const ASSET_VARIANT_NAMES = ['thumbnail', 'small', 'medium', 'large'] as const;
export type AssetVariantName = (typeof ASSET_VARIANT_NAMES)[number];

export const ASSET_VARIANT_FORMATS = ['webp', 'avif'] as const;
export type AssetVariantFormat = (typeof ASSET_VARIANT_FORMATS)[number];

export type AssetIntent = 'thumbnail' | 'card' | 'banner' | 'hero' | 'detail';

export const INTENT_TO_VARIANT: Record<AssetIntent, AssetVariantName> = {
  thumbnail: 'thumbnail',
  card: 'small',
  banner: 'medium',
  hero: 'large',
  detail: 'large',
};

interface VariantArtefact {
  url: string;
  width: number;
  height: number;
  size?: number;
  storagePath?: string;
}

interface VariantPair {
  webp: VariantArtefact;
  avif: VariantArtefact;
}

export interface AssetVariants {
  thumbnail?: VariantPair;
  small?: VariantPair;
  medium?: VariantPair;
  large?: VariantPair;
}

export interface PickedVariant {
  url: string;
  width: number;
  height: number;
  format: AssetVariantFormat;
  srcset: { url: string; width: number; format: AssetVariantFormat }[];
}

/**
 * Pure resolver — returns the canonical-variant URL + responsive srcset for an
 * intent, or null when the variants payload is absent / malformed (e.g. asset
 * still PROCESSING). Unlike the backend resolver this never throws — storefront
 * consumers fall back to the legacy `asset.url` (which after AV1 cutover IS the
 * large-webp variant URL) or to a brand-mark placeholder.
 */
export function pickVariant(variants: unknown, intent: AssetIntent): PickedVariant | null {
  const parsed = parseVariants(variants);
  if (!parsed) return null;
  const variantName = INTENT_TO_VARIANT[intent];
  const pair = parsed[variantName];
  if (!pair?.webp) return null;
  const srcset: { url: string; width: number; format: AssetVariantFormat }[] = [];
  for (const name of ASSET_VARIANT_NAMES) {
    const entry = parsed[name];
    if (!entry) continue;
    for (const fmt of ASSET_VARIANT_FORMATS) {
      const artefact = entry[fmt];
      if (!artefact) continue;
      srcset.push({ url: artefact.url, width: artefact.width, format: fmt });
    }
  }
  return {
    url: pair.webp.url,
    width: pair.webp.width,
    height: pair.webp.height,
    format: 'webp',
    srcset,
  };
}

/**
 * Build a `<picture>` source ladder from `Asset.variants` for `<app-picture>`
 * consumers. Emits one `<source>` per format with `srcset` listing every width
 * for that format. Returns an empty array when the variants payload is absent
 * — `<app-picture>` then falls back to the bare `<img [src]>` path.
 */
export function buildPictureSources(variants: unknown, sizes?: string): PictureSource[] {
  const parsed = parseVariants(variants);
  if (!parsed) return [];
  const buckets: Record<AssetVariantFormat, { url: string; width: number }[]> = {
    webp: [],
    avif: [],
  };
  for (const name of ASSET_VARIANT_NAMES) {
    const entry = parsed[name];
    if (!entry) continue;
    for (const fmt of ASSET_VARIANT_FORMATS) {
      const artefact = entry[fmt];
      if (!artefact) continue;
      buckets[fmt].push({ url: artefact.url, width: artefact.width });
    }
  }
  const sources: PictureSource[] = [];
  // avif first so the browser picks it before webp when supported.
  for (const fmt of ['avif', 'webp'] as const) {
    const entries = buckets[fmt];
    if (entries.length === 0) continue;
    const srcset = entries.map((e) => `${e.url} ${e.width}w`).join(', ');
    sources.push({
      type: fmt === 'avif' ? 'image/avif' : 'image/webp',
      srcset,
      ...(sizes ? { sizes } : {}),
    });
  }
  return sources;
}

function parseVariants(value: unknown): AssetVariants | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const out: AssetVariants = {};
  for (const name of ASSET_VARIANT_NAMES) {
    const pair = v[name];
    if (!pair || typeof pair !== 'object') continue;
    const p = pair as Record<string, unknown>;
    const webp = isArtefact(p['webp']) ? (p['webp'] as VariantArtefact) : undefined;
    const avif = isArtefact(p['avif']) ? (p['avif'] as VariantArtefact) : undefined;
    if (webp && avif) out[name] = { webp, avif };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function isArtefact(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['url'] === 'string' &&
    typeof v['width'] === 'number' &&
    typeof v['height'] === 'number'
  );
}

/**
 * The flat srcset shape the API surfaces under `primaryAsset.assetVariants` +
 * `section.config.assetVariants`. Mirrors `PublicVariantUrl.srcset` from the
 * backend resolver — see `apps/api/src/modules/assets/assets.service.ts`
 * `publicVariantUrl()`.
 */
export interface FlatVariantEntry {
  url: string;
  width: number;
  format: AssetVariantFormat;
}

/**
 * Build a `<picture>` source ladder from a flat `assetVariants` array (the
 * shape the API emits on `primaryAsset.assetVariants` and section
 * `config.assetVariants`). Returns an empty array when the payload is absent
 * or malformed — the consumer's `<app-picture>` falls back to bare
 * `<img [src]>` rendering against the AV1-canonical scalar URL.
 */
export function pictureSourcesFromAssetVariants(
  variants: unknown,
  sizes?: string,
): PictureSource[] {
  const flat = parseFlatVariants(variants);
  if (flat.length === 0) return [];
  const buckets: Record<AssetVariantFormat, FlatVariantEntry[]> = { webp: [], avif: [] };
  for (const entry of flat) buckets[entry.format].push(entry);
  const sources: PictureSource[] = [];
  for (const fmt of ['avif', 'webp'] as const) {
    const entries = buckets[fmt];
    if (entries.length === 0) continue;
    const srcset = entries.map((e) => `${e.url} ${e.width}w`).join(', ');
    sources.push({
      type: fmt === 'avif' ? 'image/avif' : 'image/webp',
      srcset,
      ...(sizes ? { sizes } : {}),
    });
  }
  return sources;
}

function parseFlatVariants(value: unknown): FlatVariantEntry[] {
  if (!Array.isArray(value)) return [];
  const out: FlatVariantEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    if (typeof v['url'] !== 'string') continue;
    if (typeof v['width'] !== 'number') continue;
    const format = v['format'];
    if (format !== 'webp' && format !== 'avif') continue;
    out.push({ url: v['url'], width: v['width'], format });
  }
  return out;
}
