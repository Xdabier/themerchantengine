import * as z from 'zod';
import { entityIdSchema } from '../shared/ids';
import { productSummarySchema } from '../shared/entities';

/**
 * Storefront search schemas. Mirrors:
 * - `apps/api/src/modules/search/dto/search-products.dto.ts:SearchProductsDto`
 * - `apps/api/src/modules/search/dto/suggest.dto.ts:SuggestDto`
 * - `apps/api/src/modules/search/dto/log-click.dto.ts:LogClickDto`
 *
 * Sort field allow-list mirrors `search.constants.VALID_SEARCH_SORT_FIELDS`.
 */

export const searchSortFieldSchema = z.enum(['relevance', 'price', 'rating', 'createdAt', 'name']);
export type SearchSortField = z.infer<typeof searchSortFieldSchema>;

export const searchProductsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  categoryId: z.string().optional(),
  priceMin: z.number().min(0).optional(),
  priceMax: z.number().min(0).optional(),
  inStock: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  sortBy: searchSortFieldSchema.optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  brand: z.string().max(100).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export type SearchProductsQuery = z.infer<typeof searchProductsQuerySchema>;

export const suggestQuerySchema = z.object({
  q: z.string().min(1).max(100),
});
export type SuggestQuery = z.infer<typeof suggestQuerySchema>;

export const filtersQuerySchema = z.object({
  q: z.string().optional(),
});
export type FiltersQuery = z.infer<typeof filtersQuerySchema>;

export const logClickRequestSchema = z.object({
  clickedProductId: z.string().min(1),
  clickPosition: z.number().int().min(0),
});
export type LogClickRequest = z.infer<typeof logClickRequestSchema>;

/**
 * The product on a `GET /v1/search` hit.
 *
 * A search hit is NOT a catalogue row and never has been. It carries no
 * `variants` array and no `currency`; it carries a rolled-up `minPrice` plus
 * `avgRating` / `reviewCount` / `thumbnail` that no other storefront endpoint
 * sends. Mirrors `ProductSearchResult` in
 * `apps/api/src/modules/search/search.service.ts`, and `search-wire.spec.ts`
 * holds the two in step against a captured response body.
 *
 * Declared per endpoint rather than folded into the shared summary, the same way
 * `productDetailSchema` extends it: `categories` is flat here and a junction
 * record on the detail payload, so one shared declaration could only be wrong for
 * one of them.
 */
export const searchHitProductSchema = productSummarySchema
  .extend({
    createdAt: z.string().optional(),
    avgRating: z.number().optional(),
    reviewCount: z.number().int().nonnegative().optional(),
    thumbnail: z.string().nullable().optional(),
    categories: z
      .array(
        z
          .object({
            id: entityIdSchema,
            name: z.unknown(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type SearchHitProduct = z.infer<typeof searchHitProductSchema>;

export const searchHitSchema = z
  .object({
    product: searchHitProductSchema,
    score: z.number().optional(),
    highlight: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
      })
      .partial()
      .optional(),
    eventId: entityIdSchema.optional(),
  })
  .passthrough();
export type SearchHit = z.infer<typeof searchHitSchema>;

export const searchResultsResponseSchema = z.array(searchHitSchema);

export const suggestItemSchema = z
  .object({
    /**
     * Discriminator from the backend `SearchService.suggest` payload. The
     * storefront uses this to branch routing between product detail
     * (`/[locale]/catalog/product/<slug>`) and category list
     * (`/[locale]/catalog/<slug>`). Optional for back-compat with older
     * suggest payloads — header `navigateToItem` falls back to the slug-only
     * heuristic when absent.
     */
    type: z.enum(['product', 'category']).optional(),
    label: z.string(),
    slug: z.string().optional(),
    productId: entityIdSchema.optional(),
  })
  .passthrough();
export type SuggestItem = z.infer<typeof suggestItemSchema>;

export const suggestResponseSchema = z.array(suggestItemSchema);
export type SuggestResponse = z.infer<typeof suggestResponseSchema>;

export const filterBucketSchema = z
  .object({
    facet: z.string(),
    values: z.array(
      z
        .object({
          value: z.string(),
          count: z.number().int().nonnegative(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type FilterBucket = z.infer<typeof filterBucketSchema>;

export const filtersResponseSchema = z.array(filterBucketSchema);
export type FiltersResponse = z.infer<typeof filtersResponseSchema>;
