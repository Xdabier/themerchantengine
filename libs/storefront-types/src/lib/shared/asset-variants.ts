import * as z from 'zod';

/**
 * Wire shape for the storefront `assetVariants` array — one entry per
 * (variant width × image format). Mirrors the backend
 * `PublicVariantUrl.srcset` produced by the canonical-variant resolver at
 * `libs/shared/common/src/asset-variants/resolver.ts`. The storefront feeds
 * this array to `pictureSourcesFromAssetVariants` to build the `<picture>`
 * source ladder.
 *
 * AV5 tightens this from the AV4 cutover-window `z.unknown()` shape — wire
 * drift is now caught at parse time rather than silently degrading a
 * `<picture>` to a fallback `<img>`.
 */
export const assetVariantEntrySchema = z.object({
  url: z.string().min(1),
  width: z.number().int().positive(),
  format: z.enum(['webp', 'avif']),
});

export type AssetVariantEntry = z.infer<typeof assetVariantEntrySchema>;

/**
 * `assetVariantsArraySchema` is `array(assetVariantEntrySchema)`. Empty
 * arrays are valid (and emitted by the backend when an asset is not READY).
 */
export const assetVariantsArraySchema = z.array(assetVariantEntrySchema);
export type AssetVariantsArray = z.infer<typeof assetVariantsArraySchema>;
