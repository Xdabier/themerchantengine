import type { PageServerLoad } from '@analogjs/router';
import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type { ApiResponse, ProductSummary } from '@storefront-types';

import { createServerApiClient } from '../../../../server/server-api-client-factory';
import { routeLocale } from '../../../../lib/locale';
import { loaderSearchParams } from '../../../../lib/loader-query';
import { resolveCatalogSort } from '../../../../lib/catalog-sort';

/**
 * Page server endpoint for `/[locale]/catalog`. Migrates the catalog landing
 * surface from the browser-only `loadFirstPage()` chain to the Analog page-
 * server-endpoint pattern established in SH2 (product detail) and SH3 (home).
 * Closes AC-5 (catalog row) by populating the product grid on the SSR HTML
 * payload — JS-less crawlers read the populated `[data-testid="catalog-grid"]`
 * + product anchors on first byte.
 *
 * Authority:
 * - DR-14 §"Decision" + §"Implementation pivot 2026-05-04"
 * - `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe`
 * - clarifications.md §1.13 (page-size cap), §1.19 (Translatable JSONB pre-
 *   resolution scoped under §1.11; remediation gated by the per-route SSR HTML
 *   payload size verifier shipped in SH6)
 *
 * Sort + filter query params are forwarded into the SSR fetch so a deep-link
 * to `?sortBy=price&sortOrder=asc&brand=Echo` ships the filtered grid in the
 * SSR HTML. Page deeper than 1 (`?page=N`) ships the page-1 slice on the SSR
 * pass; the browser hydrate runs `restoreUpToPage()` for pages 2..N per the
 * existing component contract — AC-7 is satisfied because the *primary* fetch
 * (page 1) is not duplicated.
 */

const PAGE_SIZE = 24;

export interface CatalogIndexLoadPayload {
  products: ProductSummary[];
  totalCount: number;
  /**
   * Filterable specification groups, derived by the API from the live catalogue.
   * Typed loosely on purpose: the facet set is data that changes whenever an
   * operator adds a specification, so a strict shape here would turn catalogue
   * growth into an SSR type error.
   *
   * Optional because it is secondary content: the loader soft-fails to an empty
   * list, and the page reads it with `?? []`. A payload without it renders the
   * catalogue with no filter rail rather than failing.
   */
  specFacets?: unknown[];
  /**
   * Brand facets over the whole ACTIVE catalogue, so the rail keeps every brand
   * on screen after one is selected (finding C11). Secondary content, so it
   * soft-fails to an empty list like the specification facets.
   */
  brandFacets?: { brand: string; count: number }[];
}

function readNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const load = async ({
  params: routeParams,
  event,
}: PageServerLoad): Promise<CatalogIndexLoadPayload> => {
  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(routeParams) },
  );

  // Sort + filter come from `loaderSearchParams`, not from parsing the url
  // here: a production Nitro build resolves this endpoint over an internal
  // `$fetch` that drops the search, so the url is bare and the query rides a
  // header instead. See `lib/loader-query.ts`.
  const params = loaderSearchParams(event.node.req as ServerRequest);

  const query: Record<string, string | number | boolean | undefined> = {
    ['page']: 1,
    ['pageSize']: PAGE_SIZE,
  };
  // SSR seeds page 1, so this is the order the customer actually sees first.
  // Always send a concrete pair: unset, the API falls back to `sortOrder asc`
  // over rows that all have sortOrder 0 (finding C7).
  const sort = resolveCatalogSort(params.get('sortBy'), params.get('sortOrder'));
  query['sortBy'] = sort.sortBy;
  query['sortOrder'] = sort.sortOrder;
  const brand = params.get('brand');
  if (brand) query['brand'] = brand;
  const minPrice = readNumber(params.get('minPrice') ?? undefined);
  if (minPrice !== undefined) query['minPrice'] = minPrice;
  const maxPrice = readNumber(params.get('maxPrice') ?? undefined);
  if (maxPrice !== undefined) query['maxPrice'] = maxPrice;
  // Forwarded so a shared filtered URL is already filtered in the first byte.
  // Without it the SSR HTML shows the whole catalogue and the browser then
  // swaps in the filtered set, which is a visible flash and a wrong crawl.
  const specs = params.get('specs');
  if (specs) query['specs'] = specs;

  /**
   * Catalog landing is primary content — the products grid is the page's
   * reason for existing. Hard-fail propagates 500 to the caller so the
   * `[locale]/error.page.ts` shell renders rather than an empty grid (Defect
   * B's failure mode). Soft-fail behaviour belongs on secondary content only,
   * per `agent_docs/storefront/ssr-data-loading.md` `## Error handling`.
   */
  const envelope = await apiClient.get<
    ApiResponse<ProductSummary[]> & { meta: { total?: number } }
  >('/v1/products', { query });

  /**
   * Secondary content, so it soft-fails. The rail is a navigation aid: losing it
   * should cost the customer a filter, never the catalogue. Fetched here rather
   * than only in the browser so the groups are in the SSR HTML and a deep link
   * renders with its boxes already ticked.
   */
  const [specFacets, brandFacets] = await Promise.all([
    apiClient
      .get<ApiResponse<unknown[]>>('/v1/products/spec-facets')
      .then((r) => (Array.isArray(r?.data) ? r.data : []))
      .catch<unknown[]>(() => []),
    apiClient
      .get<ApiResponse<{ brand: string; count: number }[]>>('/v1/products/brands')
      .then((r) => (Array.isArray(r?.data) ? r.data : []))
      .catch<{ brand: string; count: number }[]>(() => []),
  ]);

  return {
    products: envelope.data,
    totalCount: envelope.meta?.total ?? envelope.data.length,
    specFacets,
    brandFacets,
  };
};
