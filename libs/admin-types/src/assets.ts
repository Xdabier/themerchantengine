import * as z from 'zod';

/**
 * Response shape for `GET /v1/admin/assets/:id/original-url` (asset-variant-serving AV1).
 * The endpoint returns a short-TTL signed URL (5 min) for admin access to the
 * original bytes. Schema lives here so the admin client can validate the
 * response payload without re-importing backend types.
 */
export const assetOriginalUrlResponseSchema = z.object({
  url: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export type AssetOriginalUrlResponse = z.infer<typeof assetOriginalUrlResponseSchema>;
