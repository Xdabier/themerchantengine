import { z } from 'zod';
import {
  entityIdSchema,
  moneySchema,
  paginationMetaSchema,
  translatableSchema,
} from '@admin-types';

/** Enums mirror backend Prisma types. */
export const productStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

const codeSchema = z.string().regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/);
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Mirrors MAX_PRODUCT_SPECS in apps/api/.../dto/replace-specs.dto.ts. */
export const MAX_PRODUCT_SPECS = 50;
const money = moneySchema;
const dimension = z
  .number()
  .nonnegative()
  .refine((n) => Math.round(n * 1000) === n * 1000, {
    message: 'At most 3 decimal places',
  });

/* ── Product types ───────────────────────────────────────────────── */

export const productTypeSchema = z.object({
  id: entityIdSchema,
  name: translatableSchema,
  code: codeSchema,
  taxClassId: z.string().nullable().optional(),
  attributeCount: z.number().int().nonnegative().optional(),
});
export type ProductType = z.infer<typeof productTypeSchema>;

export const listPaginationQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type ListPaginationQuery = z.infer<typeof listPaginationQuerySchema>;

export const createProductTypeRequestSchema = z.object({
  name: translatableSchema,
  code: codeSchema,
  taxClassId: entityIdSchema.optional(),
});
export type CreateProductTypeRequest = z.infer<typeof createProductTypeRequestSchema>;

export const updateProductTypeRequestSchema = createProductTypeRequestSchema.partial();
export type UpdateProductTypeRequest = z.infer<typeof updateProductTypeRequestSchema>;

/* ── Attributes ──────────────────────────────────────────────────── */

export const attributeSchema = z.object({
  id: entityIdSchema,
  productTypeId: entityIdSchema,
  name: translatableSchema,
  code: codeSchema,
  sortOrder: z.number().int().nonnegative().optional(),
  values: z
    .array(
      z.object({
        id: entityIdSchema,
        value: translatableSchema,
        code: codeSchema,
        sortOrder: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
});
export type Attribute = z.infer<typeof attributeSchema>;

export const listAttributesQuerySchema = listPaginationQuerySchema.extend({
  productTypeId: entityIdSchema.optional(),
});
export type ListAttributesQuery = z.infer<typeof listAttributesQuerySchema>;

export const createAttributeRequestSchema = z.object({
  productTypeId: entityIdSchema,
  name: translatableSchema,
  code: codeSchema,
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CreateAttributeRequest = z.infer<typeof createAttributeRequestSchema>;

export const updateAttributeRequestSchema = createAttributeRequestSchema
  .omit({ productTypeId: true })
  .partial();
export type UpdateAttributeRequest = z.infer<typeof updateAttributeRequestSchema>;

export const createAttributeValueRequestSchema = z.object({
  value: translatableSchema,
  code: codeSchema,
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CreateAttributeValueRequest = z.infer<typeof createAttributeValueRequestSchema>;

export const updateAttributeValueRequestSchema = createAttributeValueRequestSchema.partial();
export type UpdateAttributeValueRequest = z.infer<typeof updateAttributeValueRequestSchema>;

/* ── Variants + Products ─────────────────────────────────────────── */

/**
 * Prisma.Decimal fields serialise as strings on the wire (`"289.50"`), not
 * numbers. We coerce them back to numbers so the Variant type downstream is
 * `price: number` — the ergonomic shape for product UI math. Admin list
 * queries also omit `productId` (it's fixed by path context), so it's
 * optional here.
 */
const coercedMoney = z.union([z.number(), z.string().transform((s) => Number(s))]);

export const variantSchema = z.object({
  id: entityIdSchema,
  productId: entityIdSchema.optional(),
  sku: z.string(),
  price: coercedMoney,
  compareAtPrice: coercedMoney.nullable().optional(),
  costPrice: coercedMoney.nullable().optional(),
  weight: coercedMoney.nullable().optional(),
  length: coercedMoney.nullable().optional(),
  width: coercedMoney.nullable().optional(),
  height: coercedMoney.nullable().optional(),
  barcode: z.string().nullable().optional(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  maxDownloads: z.number().int().nullable().optional(),
  downloadExpiryDays: z.number().int().nullable().optional(),
  licenseKey: z.string().nullable().optional(),
  attributeValueIds: z.array(entityIdSchema).optional(),
});
export type Variant = z.infer<typeof variantSchema>;

export const createVariantRequestSchema = z.object({
  sku: z.string().min(1),
  price: money,
  compareAtPrice: money.optional(),
  costPrice: money.optional(),
  weight: dimension.optional(),
  length: dimension.optional(),
  width: dimension.optional(),
  height: dimension.optional(),
  barcode: z.string().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  maxDownloads: z.number().int().positive().optional(),
  downloadExpiryDays: z.number().int().positive().optional(),
  licenseKey: z.string().optional(),
  attributeValueIds: z.array(entityIdSchema).optional(),
});
export type CreateVariantRequest = z.infer<typeof createVariantRequestSchema>;

export const updateVariantRequestSchema = createVariantRequestSchema.partial();
export type UpdateVariantRequest = z.infer<typeof updateVariantRequestSchema>;

/**
 * Product quality score is computed server-side and embedded on list/get
 * responses. The shape mirrors the backend scorer in
 * apps/api/src/modules/products/quality-score.service.ts.
 */
export const qualityScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  grade: z.enum(['red', 'amber', 'yellow', 'green']),
  breakdown: z.record(z.string(), z.boolean()).optional(),
});
export type QualityScore = z.infer<typeof qualityScoreSchema>;

/**
 * Asset envelope nested inside a product asset row.
 *
 * `alt` is the only Translatable field — it accepts a localized object
 * or a server-resolved string when the global locale-resolution
 * interceptor has narrowed the response. Mirrors `assetSchema` in
 * `libs/admin-services/src/assets/assets.schemas.ts`.
 */
export const productAssetEnvelopeSchema = z.object({
  id: entityIdSchema,
  // AV3 — accept both an empty string (PROCESSING / PENDING / FAILED rows
  // before the processor flips `Asset.url` to the canonical large-webp
  // variant URL) and a fully qualified URL. Mirrors the same union used
  // in `assetSchema` (`assets.schemas.ts`). Without this, every product
  // GET would throw a ZodError as soon as a freshly-uploaded asset is
  // attached, blocking the product-edit page until the upload finishes.
  url: z.union([z.literal(''), z.string().url()]),
  type: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO']),
  alt: z.union([z.string(), translatableSchema]).nullable().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']),
  mimeType: z.string(),
  fileSize: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  // AV3 — mirror the admin Asset shape. Optional so legacy GET responses
  // served before AV3.18 widens the backend select still parse; the admin
  // resolver shim returns null when this is absent and the template falls
  // back to a status-label block instead of a broken `<img>`.
  variants: z.unknown().optional(),
});
export type ProductAssetEnvelope = z.infer<typeof productAssetEnvelopeSchema>;

export const productAssetWithAssetSchema = z.object({
  assetId: entityIdSchema,
  sortOrder: z.number().int().nonnegative(),
  isPrimary: z.boolean(),
  // `asset` is present on detail (GET /products/:id) but absent on list
  // (GET /products) — the list select does not include the nested join.
  // Optional here so the same schema validates both list and detail responses.
  asset: productAssetEnvelopeSchema.optional(),
});
export type ProductAssetWithAsset = z.infer<typeof productAssetWithAssetSchema>;

/**
 * Lightweight FAQ reference embedded in `productSchema.faqs`. The admin LIST
 * endpoint (`apps/api/src/modules/products/products.service.ts`) selects only
 * `id` to keep the list payload small (count signal for the quality scorer);
 * the DETAIL endpoint returns the full row. Making `question` and `answer`
 * optional lets the same shape parse both list and detail responses.
 *
 * For create/update FAQ mutations the strict `productFaqSchema` is still used
 * to validate that the backend returned a fully-populated row.
 */
export const productFaqRefSchema = z.object({
  id: entityIdSchema,
  productId: entityIdSchema.optional(),
  question: translatableSchema.optional(),
  answer: translatableSchema.optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type ProductFaqRef = z.infer<typeof productFaqRefSchema>;

export const productFaqSchema = z.object({
  id: entityIdSchema,
  productId: entityIdSchema.optional(),
  question: translatableSchema,
  answer: translatableSchema,
  sortOrder: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type ProductFaq = z.infer<typeof productFaqSchema>;

/**
 * One `ProductCategory` junction row from the detail include.
 *
 * The joined `category` is optional because only the detail response includes
 * it; the list response returns the bare junction. It is also deliberately
 * lenient about the joined shape: this schema guards a field the edit page
 * reads to pre-check its category boxes, and a strict sub-schema here would
 * turn a category the parse does not recognise into a thrown ZodError that
 * blanks the whole product page. That is the schema-drift failure this key was
 * added to close, not one to reintroduce a level down. `categoryId` stays
 * strict because the page sends it straight back as `categoryIds`.
 */
export const productCategoryRefSchema = z.object({
  productId: entityIdSchema.optional(),
  categoryId: entityIdSchema,
  category: z
    .object({
      id: entityIdSchema,
      name: translatableSchema,
      slug: z.string(),
    })
    .partial()
    .nullable()
    .optional()
    .catch(undefined),
});
export type ProductCategoryRef = z.infer<typeof productCategoryRefSchema>;

/* ── Product specifications ──────────────────────────────────────── */

/**
 * One persisted specification row.
 *
 * `key` and `valueKey` are the accent-folded forms the server derives; they are
 * read-only here and never sent back. `label` and `value` are strict
 * Translatables: the server rejects a label with no `default`, because `key` is
 * folded from exactly that field, so a `default`-less row cannot reach the
 * client and the lenient variant is not needed.
 */
export const productSpecSchema = z.object({
  id: entityIdSchema,
  productId: entityIdSchema.optional(),
  label: translatableSchema,
  value: translatableSchema,
  key: z.string(),
  valueKey: z.string(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type ProductSpec = z.infer<typeof productSpecSchema>;

/**
 * The replace payload: the product's complete specification set in display
 * order. Rows the array omits are removed server-side.
 *
 * Carries label and value only. `key`, `valueKey` and `sortOrder` are all
 * server-derived, and the backend runs `forbidNonWhitelisted`, so sending any
 * of them is a 400 rather than a silent overwrite of the uniqueness key.
 */
export const replaceProductSpecsRequestSchema = z.object({
  specs: z
    .array(
      z.object({
        label: translatableSchema,
        value: translatableSchema,
      }),
    )
    .max(MAX_PRODUCT_SPECS),
});
export type ReplaceProductSpecsRequest = z.infer<typeof replaceProductSpecsRequestSchema>;

/**
 * One option in the cross-catalogue label autocomplete.
 *
 * `label` is nullable because the server resolves a representative spelling per
 * folded key in a second query; a key whose row vanished between the two reads
 * yields null rather than failing the whole parse.
 */
export const specLabelOptionSchema = z.object({
  key: z.string(),
  label: translatableSchema.nullable(),
  productCount: z.number().int().nonnegative(),
});
export type SpecLabelOption = z.infer<typeof specLabelOptionSchema>;

export const listSpecLabelsQuerySchema = z.object({
  search: z.string().max(120).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(50).optional(),
});
export type ListSpecLabelsQuery = z.infer<typeof listSpecLabelsQuerySchema>;

export const listSpecLabelsResponseSchema = z.object({
  data: z.array(specLabelOptionSchema),
  meta: paginationMetaSchema,
});
export type ListSpecLabelsResponse = z.infer<typeof listSpecLabelsResponseSchema>;

export const productSchema = z.object({
  id: entityIdSchema,
  name: translatableSchema,
  slug: slugSchema,
  description: translatableSchema.nullable().optional(),
  shortDescription: translatableSchema.nullable().optional(),
  status: productStatusSchema,
  productTypeId: entityIdSchema.nullable().optional(),
  // Joined product type (the GET /products/:id response already includes it).
  // Lets the detail screen show the type NAME instead of the raw UUID.
  productType: z
    .object({ id: entityIdSchema, name: translatableSchema, code: z.string() })
    .nullable()
    .optional(),
  brand: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  isFeatured: z.boolean().optional(),
  isDigital: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  metaTitle: translatableSchema.nullable().optional(),
  metaDescription: translatableSchema.nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  qualityScore: qualityScoreSchema.optional(),
  variants: z.array(variantSchema).optional(),
  faqs: z.array(productFaqRefSchema).optional(),
  assets: z.array(productAssetWithAssetSchema).optional(),
  categories: z.array(productCategoryRefSchema).optional(),
  specs: z.array(productSpecSchema).optional(),
});
export type Product = z.infer<typeof productSchema>;

export const listProductsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  status: productStatusSchema.optional(),
  categoryId: entityIdSchema.optional(),
  productTypeId: entityIdSchema.optional(),
  brand: z.string().optional(),
  isFeatured: z.boolean().optional(),
  search: z.string().optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const listProductsResponseSchema = z.object({
  data: z.array(productSchema),
  meta: paginationMetaSchema,
});
export type ListProductsResponse = z.infer<typeof listProductsResponseSchema>;

export const createProductRequestSchema = z.object({
  name: translatableSchema,
  slug: slugSchema.optional(),
  description: translatableSchema.optional(),
  shortDescription: translatableSchema.optional(),
  status: productStatusSchema.optional(),
  productTypeId: entityIdSchema.optional(),
  brand: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isFeatured: z.boolean().optional(),
  isDigital: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  metaTitle: translatableSchema.optional(),
  metaDescription: translatableSchema.optional(),
  categoryIds: z.array(entityIdSchema).optional(),
  assetIds: z.array(entityIdSchema).optional(),
  variants: z.array(createVariantRequestSchema).optional(),
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = createProductRequestSchema
  .omit({ variants: true, assetIds: true })
  .partial();
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

/* ── Bulk ops ───────────────────────────────────────────────────── */

export const bulkUpdatePricesRequestSchema = z.object({
  items: z.array(z.object({ variantId: entityIdSchema, price: money })).nonempty(),
});
export type BulkUpdatePricesRequest = z.infer<typeof bulkUpdatePricesRequestSchema>;

export const bulkUpdateStatusRequestSchema = z.object({
  productIds: z.array(entityIdSchema).nonempty(),
  status: productStatusSchema,
});
export type BulkUpdateStatusRequest = z.infer<typeof bulkUpdateStatusRequestSchema>;

/* ── Product assets + FAQs ──────────────────────────────────────── */

export const updateProductAssetsRequestSchema = z.object({
  assets: z
    .array(
      z.object({
        assetId: entityIdSchema,
        sortOrder: z.number().int().nonnegative(),
        isPrimary: z.boolean(),
      }),
    )
    .nonempty(),
});
export type UpdateProductAssetsRequest = z.infer<typeof updateProductAssetsRequestSchema>;

export const createProductFaqRequestSchema = z.object({
  question: translatableSchema,
  answer: translatableSchema,
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CreateProductFaqRequest = z.infer<typeof createProductFaqRequestSchema>;

export const updateProductFaqRequestSchema = createProductFaqRequestSchema.partial();
export type UpdateProductFaqRequest = z.infer<typeof updateProductFaqRequestSchema>;
