import { z } from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

export const assetStatusSchema = z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

export const assetTypeSchema = z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO']);
export type AssetType = z.infer<typeof assetTypeSchema>;

export const assetSchema = z.object({
  id: entityIdSchema,
  // Asset-variant-serving (AV1) — `url` is empty on PROCESSING / PENDING
  // assets (the image processor flips it to the canonical large-webp variant
  // URL on `READY`). The schema accepts both an empty string and a fully
  // qualified URL so admin clients can validate every status row uniformly.
  url: z.union([z.literal(''), z.string().url()]),
  status: assetStatusSchema,
  type: assetTypeSchema,
  mimeType: z.string(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  fileSize: z.number().int().nonnegative(),
  blurhash: z.string().nullable().optional(),
  alt: z.union([z.string(), translatableSchema]).nullable().optional(),
  // AV3 — `variants` carries the canonical processed-output payload so the
  // admin-side resolver shim (`AssetsService.publicVariantUrl`) can pick a
  // variant URL per intent. Treated as opaque here; the canonical
  // `assetVariantsSchema` from `libs/shared/common/src/asset-variants` is the
  // authoritative parser inside the resolver. Optional + nullable so PENDING
  // and pre-AV1 backfill rows still parse.
  variants: z.unknown().optional(),
  // AV3 — present on admin payloads so the asset-detail "Download original"
  // button can disable when the original has been deleted post-cutover.
  // Optional + nullable so list responses (which omit it for payload size)
  // still parse and PENDING rows that have not yet had an original written
  // do not fail.
  originalStoragePath: z.string().nullable().optional(),
  createdAt: z.union([z.string().datetime(), z.date()]),
  updatedAt: z.union([z.string().datetime(), z.date()]),
});
export type Asset = z.infer<typeof assetSchema>;

export const assetUsageSchema = z.object({
  products: z.number().int().nonnegative(),
  reviews: z.number().int().nonnegative(),
  returns: z.number().int().nonnegative(),
  categories: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type AssetUsage = z.infer<typeof assetUsageSchema>;

export const assetWithUsageSchema = assetSchema.extend({
  usage: assetUsageSchema,
});
export type AssetWithUsage = z.infer<typeof assetWithUsageSchema>;

export const listAssetsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  type: assetTypeSchema.optional(),
  status: assetStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

export const listAssetsResponseSchema = z.object({
  data: z.array(assetSchema),
  meta: paginationMetaSchema,
});
export type ListAssetsResponse = z.infer<typeof listAssetsResponseSchema>;

// ── Asset references (S18 — DR-07) ──────────────────────────────────────────

export const assetReferenceKindSchema = z.enum([
  'product',
  'variant',
  'review',
  'return',
  'category',
  'section',
]);
export type AssetReferenceKind = z.infer<typeof assetReferenceKindSchema>;

export const assetReferenceRowSchema = z.object({
  kind: assetReferenceKindSchema,
  id: entityIdSchema,
  label: z.string(),
  route: z.string(),
});
export type AssetReferenceRow = z.infer<typeof assetReferenceRowSchema>;

export const assetReferencesSchema = z.object({
  products: z.array(assetReferenceRowSchema),
  variants: z.array(assetReferenceRowSchema),
  reviews: z.array(assetReferenceRowSchema),
  returns: z.array(assetReferenceRowSchema),
  categories: z.array(assetReferenceRowSchema),
  sections: z.array(assetReferenceRowSchema),
  total: z.number().int().nonnegative(),
});
export type AssetReferences = z.infer<typeof assetReferencesSchema>;

export const getAssetReferencesQuerySchema = z.object({
  type: assetReferenceKindSchema.optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
});
export type GetAssetReferencesQuery = z.infer<typeof getAssetReferencesQuerySchema>;
