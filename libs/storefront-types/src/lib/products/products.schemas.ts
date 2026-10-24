import * as z from 'zod';
import { productDetailSchema, productSummarySchema } from '../shared/entities';

/**
 * Storefront products schemas. Mirrors
 * `apps/api/src/modules/products/dto/query-products.dto.ts:ListProductsStorefrontDto`
 * for the request shape; response shapes derive from the storefront-api
 * reference §"Products".
 *
 * `sortBy` is a per-endpoint allowlist on the client per constitution §3.5
 * sort-field allowlist: the backend DTO accepts free-form `IsString` but the
 * storefront enforces the documented columns from `docs/storefront-api-reference.md:311`
 * (`createdAt`, `price`, `name`) so the client never forwards arbitrary
 * column names.
 */

export const productListSortFieldSchema = z.enum(['createdAt', 'price', 'name']);
export type ProductListSortField = z.infer<typeof productListSortFieldSchema>;

/**
 * A price bound at the store currency's own scale: non-negative, at most three
 * decimals.
 *
 * These were `z.number().int()`, which rejected three of the four catalogue
 * price bands outright. Their bounds are half-open by a millime (`under50` is
 * `max: 49.999`) so the four partition the range with neither a dead zone nor
 * an overlap, and the catalogue page swallows a parse throw and renders an
 * empty grid with no error — permanently, and silently. The gate moves to the
 * millime rather than disappearing: a fourth decimal is still not a price.
 */
const moneyBound = z
  .number()
  .min(0)
  .refine((n) => Math.round(n * 1000) === n * 1000, { message: 'At most 3 decimal places' });

export const listProductsQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sortBy: productListSortFieldSchema.optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  categoryId: z.string().optional(),
  brand: z.string().optional(),
  tags: z.string().optional(),
  /**
   * Comma-joined `specKey:valueKey` tokens. Values within one specification OR,
   * specifications AND. Declared here or the client serialiser strips it.
   */
  specs: z.string().optional(),
  minPrice: moneyBound.optional(),
  maxPrice: moneyBound.optional(),
  isFeatured: z.boolean().optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const productSummaryListSchema = z.array(productSummarySchema);

/**
 * One brand facet from `GET /v1/products/brands`.
 *
 * Two scalars and a stable meaning, unlike the specification facets, so this
 * one is worth a real schema: the rail renders `brand` as the radio value it
 * later sends back as `?brand=`, and a silent shape drift there is a filter
 * that matches nothing.
 */
export const brandFacetSchema = z.object({
  brand: z.string().min(1),
  count: z.number().int().nonnegative(),
});
export type BrandFacet = z.infer<typeof brandFacetSchema>;

export const brandFacetListSchema = z.array(brandFacetSchema);

export { productDetailSchema, productSummarySchema };
export type { ProductDetail, ProductSummary } from '../shared/entities';
