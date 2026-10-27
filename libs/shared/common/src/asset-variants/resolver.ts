import {
  ASSET_VARIANT_FORMATS,
  ASSET_VARIANT_NAMES,
  INTENT_TO_VARIANT,
  assetVariantsSchema,
  type AssetIntent,
  type AssetVariantFormat,
  type AssetVariants,
} from './asset-variants.schema';

/**
 * Resolver error classes — see `agent_docs/assets-pipeline.md` §1.
 *
 * Thrown by the pure resolver when an asset cannot resolve to a public variant
 * URL. Callers in user-facing projection paths catch and surface a placeholder
 * (e.g. blurhash) rather than crashing.
 */
export class AssetNotReadyError extends Error {
  constructor(
    public readonly assetId: string,
    public readonly status: string,
  ) {
    super(`Asset ${assetId} is not READY (status=${status})`);
    this.name = 'AssetNotReadyError';
  }
}

export class AssetFailedError extends Error {
  constructor(public readonly assetId: string) {
    super(`Asset ${assetId} processing FAILED`);
    this.name = 'AssetFailedError';
  }
}

export class AssetVariantMissingError extends Error {
  constructor(
    public readonly assetId: string,
    public readonly variantName: string,
  ) {
    super(`Asset ${assetId} is missing variant "${variantName}"`);
    this.name = 'AssetVariantMissingError';
  }
}

export interface PublicVariantUrl {
  url: string;
  width: number;
  height: number;
  format: AssetVariantFormat;
  srcset?: { url: string; width: number; format: AssetVariantFormat }[];
}

export interface ResolvableAsset {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  variants: unknown;
}

/**
 * Pure canonical-variant resolver — see `agent_docs/assets-pipeline.md` §1.
 *
 * Reads `Asset.variants` JSONB and returns the URL for the intent's canonical
 * variant. Throws when the asset is not READY or the variants payload is
 * malformed. Pure function — no DB, no I/O. Consumers in any module call this
 * directly without dependency injection.
 */
export function pickVariantUrl(asset: ResolvableAsset, intent: AssetIntent): PublicVariantUrl {
  if (asset.status === 'PROCESSING' || asset.status === 'PENDING') {
    throw new AssetNotReadyError(asset.id, asset.status);
  }
  if (asset.status === 'FAILED') {
    throw new AssetFailedError(asset.id);
  }
  const variantName = INTENT_TO_VARIANT[intent];
  const variants = parseVariants(asset);
  const pair = variants[variantName];
  if (!pair?.webp) {
    throw new AssetVariantMissingError(asset.id, variantName);
  }
  const webp = pair.webp;
  const srcset: { url: string; width: number; format: AssetVariantFormat }[] = [];
  for (const name of ASSET_VARIANT_NAMES) {
    const entry = variants[name];
    if (!entry) continue;
    for (const fmt of ASSET_VARIANT_FORMATS) {
      const artefact = entry[fmt];
      if (!artefact) continue;
      srcset.push({ url: artefact.url, width: artefact.width, format: fmt });
    }
  }
  return { url: webp.url, width: webp.width, height: webp.height, format: 'webp', srcset };
}

/**
 * Soft variant — returns null instead of throwing when the asset is not READY
 * or its variants payload is malformed. Used by projection paths that want a
 * graceful fallback (e.g. cart thumbnail returns null while processing).
 */
export function tryPickVariantUrl(
  asset: ResolvableAsset | null | undefined,
  intent: AssetIntent,
): PublicVariantUrl | null {
  if (!asset) return null;
  try {
    return pickVariantUrl(asset, intent);
  } catch {
    return null;
  }
}

function parseVariants(asset: ResolvableAsset): AssetVariants {
  if (!asset.variants || typeof asset.variants !== 'object') {
    throw new AssetVariantMissingError(asset.id, 'variants');
  }
  const parsed = assetVariantsSchema.safeParse(asset.variants);
  if (!parsed.success) {
    throw new AssetVariantMissingError(asset.id, 'variants');
  }
  return parsed.data;
}
