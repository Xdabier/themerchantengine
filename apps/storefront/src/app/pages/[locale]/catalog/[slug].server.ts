import { createError } from 'h3';
import type { PageServerLoad } from '@analogjs/router';
import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type { ApiResponse, Category, ProductSummary } from '@storefront-types';

import { createServerApiClient } from '../../../../server/server-api-client-factory';
import { readErrorStatus } from '../../../../server/server-companion-helpers';
import { routeLocale } from '../../../../lib/locale';
import { loaderSearchParams } from '../../../../lib/loader-query';
import { resolveCatalogSort } from '../../../../lib/catalog-sort';

/**
 * Page server endpoint for `/[locale]/catalog/[slug]`. Migrates the category
 * detail surface from the browser-only `hydrate()` chain to the Analog page-
 * server-endpoint pattern. Closes AC-5 (category row): the resolved category
 * + its first-page product grid + breadcrumb leaf land in the SSR HTML, so
 * JS-less crawlers index the localised category copy + Product anchors on
 * first byte.
 *
 * Authority:
 * - DR-14 §"Decision" + §"Implementation pivot 2026-05-04"
 * - `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe`,
 *   `## Error handling` (hard 404 on category miss)
 * - clarifications.md §1.13 (page-size cap), §1.19 (Translatable JSONB pre-
 *   resolution scoped under §1.11; remediation gated by the per-route SSR HTML
 *   payload size verifier shipped in SH6)
 *
 * Sort + filter query params are forwarded into the products fetch so deep-
 * link `/[locale]/catalog/<slug>?sortBy=price&...` ships the filtered grid
 * in the SSR HTML. `?page=N>1` ships the page-1 slice; the browser hydrate
 * runs the existing restore-up-to-page chain for pages 2..N.
 */

const PAGE_SIZE = 24;

export interface CatalogCategoryLoadPayload {
  /** Filterable specification groups. Optional: secondary content, soft-fails. */
  specFacets?: unknown[];
  category: Category;
  products: ProductSummary[];
  totalCount: number;
  /** True when the products fetch failed. Distinguishes an outage from an
   * empty category. */
  productsError?: boolean;
  /**
   * Brand facets over the whole ACTIVE catalogue, so the rail keeps every brand
   * on screen after one is selected (finding C11). Secondary content, so it
   * soft-fails to an empty list like the specification facets.
   */
  brandFacets?: { brand: string; count: number }[];
}

function readNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const load = async ({
  params,
  event,
}: PageServerLoad): Promise<CatalogCategoryLoadPayload> => {
  const slug = String(params?.['slug'] ?? '');
  if (!slug) {
    throw createError({ statusCode: 404, statusMessage: 'Category not found' });
  }

  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(params) },
  );

  /**
   * Category is primary content, the page exists to surface its products.
   * Hard 404 throw on miss propagates a 404 to the response and renders the
   * `[locale]/[...not-found].page.ts` shell instead of an empty grid. Per
   * `agent_docs/storefront/ssr-data-loading.md` `## Error handling`.
   */
  let category: Category;
  try {
    const envelope = await apiClient.get<ApiResponse<Category>>(
      `/v1/categories/${encodeURIComponent(slug)}`,
    );
    category = envelope.data;
  } catch (err) {
    if (readErrorStatus(err) === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Category not found' });
    }
    throw err;
  }

  // Build the product list query the same way the component's
  // `buildListQuery()` does, sort + filter + page from the request query, so
  // the SSR grid matches the deep-linked browser grid. `loaderSearchParams`
  // rather than a url parse: see `lib/loader-query.ts`.
  const qp = loaderSearchParams(event.node.req as ServerRequest);
  const productsQuery: Record<string, string | number | boolean | undefined> = {
    ['categoryId']: category.id,
    ['page']: 1,
    ['pageSize']: PAGE_SIZE,
  };
  // SSR seeds page 1, so this is the order the customer actually sees first.
  // Always send a concrete pair: unset, the API falls back to `sortOrder asc`
  // over rows that all have sortOrder 0 (finding C7).
  const sort = resolveCatalogSort(qp.get('sortBy'), qp.get('sortOrder'));
  productsQuery['sortBy'] = sort.sortBy;
  productsQuery['sortOrder'] = sort.sortOrder;
  const brand = qp.get('brand');
  if (brand) productsQuery['brand'] = brand;
  const minPrice = readNumber(qp.get('minPrice'));
  if (minPrice !== undefined) productsQuery['minPrice'] = minPrice;
  const maxPrice = readNumber(qp.get('maxPrice'));
  if (maxPrice !== undefined) productsQuery['maxPrice'] = maxPrice;
  // Forwarded so a shared filtered URL is filtered in the first byte.
  const specs = qp.get('specs');
  if (specs) productsQuery['specs'] = specs;

  /**
   * Products grid is secondary content, a 500 on the products endpoint must
   * not 500 the page. The category itself is already resolved; an empty grid
   * with the category header beats the `[locale]/error.page.ts` shell.
   */
  const productsEnvelope = await apiClient
    .get<ApiResponse<ProductSummary[]> & { meta: { total?: number } }>('/v1/products', {
      query: productsQuery,
    })
    .catch(() => null);

  // Secondary content, so it soft-fails: losing the rail must never cost the
  // category page its products.
  const [specFacets, brandFacets] = await Promise.all([
    apiClient
      .get<{ data?: unknown[] }>('/v1/products/spec-facets')
      .then((r) => (Array.isArray(r?.data) ? r.data : []))
      .catch<unknown[]>(() => []),
    apiClient
      .get<{ data?: { brand: string; count: number }[] }>('/v1/products/brands', {
        query: { categoryId: category.id },
      })
      .then((r) => (Array.isArray(r?.data) ? r.data : []))
      .catch<{ brand: string; count: number }[]>(() => []),
  ]);

  return {
    category,
    products: productsEnvelope?.data ?? [],
    totalCount: productsEnvelope?.meta?.total ?? productsEnvelope?.data.length ?? 0,
    // Carried so the page can say the products failed to load rather than
    // rendering the category as empty (finding C10).
    productsError: productsEnvelope === null,
    specFacets,
    brandFacets,
  };
};
