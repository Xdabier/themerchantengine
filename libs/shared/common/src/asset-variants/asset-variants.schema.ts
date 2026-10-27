import * as z from 'zod';

/**
 * Canonical variant set — see `agent_docs/assets-pipeline.md` §5.
 * The image processor writes every entry on `READY`; the resolver throws
 * `AssetVariantMissingError` when any entry is absent on a READY asset.
 */
export const ASSET_VARIANT_NAMES = ['thumbnail', 'small', 'medium', 'large'] as const;
export type AssetVariantName = (typeof ASSET_VARIANT_NAMES)[number];

export const ASSET_VARIANT_FORMATS = ['webp', 'avif'] as const;
export type AssetVariantFormat = (typeof ASSET_VARIANT_FORMATS)[number];

/**
 * Canonical video rendition set (AV2) — see `agent_docs/assets-pipeline.md` §5.
 * The video processor writes every entry on `READY` for VIDEO assets.
 */
export const VIDEO_RENDITION_NAMES = ['mobile', 'tablet', 'desktop', 'desktop-webm'] as const;
export type VideoRenditionName = (typeof VIDEO_RENDITION_NAMES)[number];

const variantArtefactSchema = z.object({
  url: z.string().min(1),
  storagePath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  size: z.number().int().nonnegative(),
});

const variantPairSchema = z.object({
  webp: variantArtefactSchema,
  avif: variantArtefactSchema,
});

const videoRenditionArtefactSchema = z.object({
  url: z.string().min(1),
  storagePath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  container: z.enum(['mp4', 'webm']),
  codec: z.string().min(1),
  bitrate: z.string().min(1),
});

/**
 * Image asset variant set — top-level pairs at the four canonical widths.
 * The pure resolver `pickVariantUrl` reads `variants[name].webp` against this
 * shape for IMAGE assets. `.strict()` so that a payload carrying a stray
 * `renditions` key (i.e. a video payload) cannot fall through the union to
 * be interpreted as an image with the renditions silently stripped.
 */
export const imageAssetVariantsSchema = z
  .object({
    thumbnail: variantPairSchema,
    small: variantPairSchema,
    medium: variantPairSchema,
    large: variantPairSchema,
  })
  .strict();

/**
 * Video asset variant set (AV2) — same top-level pairs as the image shape
 * (carrying the poster frame at the four canonical widths) PLUS a `renditions`
 * object with the four mp4/webm transcodes. The image-shape pairs sit at the
 * top level (rather than under a `poster` key) so the pure resolver
 * `pickVariantUrl` reads `variants[name].webp` unchanged for both shapes —
 * VIDEO consumers that need the playback streams read `variants.renditions`
 * directly. See `agent_docs/assets-pipeline.md` §5.
 */
export const videoAssetVariantsSchema = z.object({
  thumbnail: variantPairSchema,
  small: variantPairSchema,
  medium: variantPairSchema,
  large: variantPairSchema,
  renditions: z.object({
    mobile: videoRenditionArtefactSchema,
    tablet: videoRenditionArtefactSchema,
    desktop: videoRenditionArtefactSchema,
    'desktop-webm': videoRenditionArtefactSchema,
  }),
});

/**
 * Locked shape for `Asset.variants` JSONB on `READY` assets.
 * Per clarifications R7 the schema is the single source of truth for the
 * variant payload — backend writes through `parse(...)` and admin/storefront
 * read through it. AV2 widens the schema to a video|image union without a
 * `type` discriminator field: video payloads are distinguished by the
 * presence of the required `renditions` key (image payloads omit it). Order
 * is video-first so the more-specific schema matches before the image
 * fallback.
 */
export const assetVariantsSchema = z.union([videoAssetVariantsSchema, imageAssetVariantsSchema]);

export type AssetVariantArtefact = z.infer<typeof variantArtefactSchema>;
export type AssetVariantPair = z.infer<typeof variantPairSchema>;
export type ImageAssetVariants = z.infer<typeof imageAssetVariantsSchema>;
export type VideoAssetVariants = z.infer<typeof videoAssetVariantsSchema>;
export type AssetVariants = z.infer<typeof assetVariantsSchema>;
export type VideoRenditionArtefact = z.infer<typeof videoRenditionArtefactSchema>;

/** Per-intent canonical variant choice — see `agent_docs/assets-pipeline.md` §2. */
export type AssetIntent = 'thumbnail' | 'card' | 'banner' | 'hero' | 'detail';

export const INTENT_TO_VARIANT: Record<AssetIntent, AssetVariantName> = {
  thumbnail: 'thumbnail',
  card: 'small',
  banner: 'medium',
  hero: 'large',
  detail: 'large',
};
