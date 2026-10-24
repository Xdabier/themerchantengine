export const PRODUCTS_REDIS_CLIENT = 'PRODUCTS_REDIS_CLIENT';

/** Per-product quality score: key = products:quality:<productId> */
export const PRODUCT_QUALITY_CACHE_PREFIX = 'products:quality:';

/** 5-minute TTL for quality scores */
export const PRODUCT_QUALITY_TTL_SECONDS = 300;

/**
 * Storefront product detail cache: key = products:detail:v2:<slug>
 *
 * Bumped to `v2` with the plan J variant select. Payloads written under the old
 * prefix carry `costPrice` and `licenseKey`; a new prefix retires them at
 * deploy instead of letting them serve for the rest of their 300 s TTL. Old
 * keys age out on their own, so no flush script is needed.
 */
export const PRODUCT_DETAIL_CACHE_PREFIX = 'products:detail:v2:';

/** 5-minute TTL for storefront product detail (spec §08) */
export const PRODUCT_DETAIL_TTL_SECONDS = 300;

/** Allowlist for admin product list sortBy query param */
export const VALID_PRODUCT_SORT_FIELDS = [
  'sortOrder',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'name',
] as const;

/**
 * Storefront sort fields the database can order on directly, as a Prisma
 * `orderBy` on a `Product` column. Skip/take stays in SQL for these.
 */
export const STOREFRONT_COLUMN_SORT_FIELDS = ['sortOrder', 'publishedAt', 'createdAt'] as const;

/**
 * Storefront sort fields that are NOT `Product` columns and cannot be a Prisma
 * `orderBy`:
 *
 * - `price` lives on `ProductVariant`, a to-many relation. Prisma can only
 *   order by a to-ONE relation's field, so there is no `orderBy` that reaches
 *   it, and the catalogue must not sort on a price no card ever shows.
 * - `name` is Translatable JSONB. Prisma can order by the column, but that is a
 *   jsonb comparison over the whole object: it compares keys before values, so
 *   it sorts every locale by the `en` string. A French catalogue sorted by the
 *   English name is not "Name: A to Z".
 *
 * Both are ordered in the service instead, over the filtered id set. See
 * `ProductsService.orderedIdsForComputedSort`.
 */
export const STOREFRONT_COMPUTED_SORT_FIELDS = ['price', 'name'] as const;

/**
 * Allowlist for the storefront product list `sortBy` query param.
 *
 * Per-endpoint column allowlist (§08): the request value is matched against
 * this list and never interpolated. The catalogue sort control offers Newest,
 * Price low to high, Price high to low and Name A to Z, so `price` and `name`
 * have to be here or three of the four options do nothing but flip a direction
 * on `sortOrder`, which every product shares.
 */
export const VALID_STOREFRONT_SORT_FIELDS = [
  ...STOREFRONT_COLUMN_SORT_FIELDS,
  ...STOREFRONT_COMPUTED_SORT_FIELDS,
] as const;

/** Allowlist for variant list sortBy */
export const VALID_VARIANT_SORT_FIELDS = ['createdAt', 'price', 'sku'] as const;

/** Data quality score weights — must sum to 100 */
export const QUALITY_WEIGHTS = {
  hasNameAllLocales: 10,
  hasDescriptionAllLocales: 15,
  hasShortDescriptionAllLocales: 10,
  hasThreePlusImages: 15,
  hasPrimaryCategory: 10,
  hasVariantWithPrice: 10,
  allVariantsHaveSku: 5,
  hasMetaTitleAllLocales: 5,
  hasMetaDescriptionAllLocales: 5,
  hasWeight: 5,
  hasFaq: 5,
  descriptionAnswerFirst: 5,
} as const;

export type QualityGrade = 'red' | 'yellow' | 'green';

export function gradeFromScore(score: number): QualityGrade {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

/** SEO redirect event — emitted when a product's slug changes */
export const PRODUCT_SLUG_CHANGED_EVENT = 'product.slug.changed';

/** Search reindex + SEO submission event — emitted on product create, update, restore, or archive */
export const PRODUCT_MUTATED_EVENT = 'product.mutated';

/**
 * Payload for {@link PRODUCT_MUTATED_EVENT}. `slug` + `shouldSubmitIndexNow` were
 * added by the SEO discovery-hardening change ([DR-15]) so the revalidation listener
 * can submit the product's public URLs to IndexNow on publish / live-edit / removal
 * without a cross-module DB read.
 *
 * `shouldSubmitIndexNow` is computed at the service layer (the only place that knows
 * the prev→next visibility transition). It is `true` only when the product is — or has
 * just become, or has just stopped being — publicly indexable (status ACTIVE, not
 * soft-deleted) AND the slug did NOT change in the same operation. A slug change is
 * handled separately by {@link PRODUCT_SLUG_CHANGED_EVENT}, which submits both the old
 * and the new URL; suppressing it here avoids a redundant double-submission.
 */
export interface ProductMutatedEventPayload {
  productId: string;
  slug: string;
  shouldSubmitIndexNow: boolean;
}

/**
 * The `ProductVariant` columns the PUBLIC product detail may return.
 *
 * `GET /v1/products/:slug` is `@Public()`, so this select IS the public
 * contract. Everything absent is absent on purpose (plan J, sweep S1):
 * `costPrice` is the merchant's purchase cost, `licenseKey` is the paid
 * deliverable on a digital variant, and `barcode`, `weight`, the dimensions,
 * the download policy and the row timestamps are internal. `availability` is
 * attached after the query by the inventory grade, never selected.
 */
export const PUBLIC_VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  price: true,
  compareAtPrice: true,
  isDefault: true,
} as const;
