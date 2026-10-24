import type { PageServerLoad } from '@analogjs/router';
import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type { ApiResponse, FiltersResponse, PaginationMeta, SearchHit } from '@storefront-types';

import { createServerApiClient } from '../../../../server/server-api-client-factory';
import { routeLocale } from '../../../../lib/locale';
import { loaderSearchParams } from '../../../../lib/loader-query';

/**
 * Page server endpoint for `/[locale]/search`. Migrates the search results
 * surface from the browser-only `hydrate()` chain to the Analog page-server-
 * endpoint pattern. Closes AC-5 (search row): search results + facet buckets
 * land in the SSR HTML payload when `?q=` is present, so JS-less crawlers
 * read populated `[data-testid="catalog-grid"]` + product anchors on first
 * byte.
 *
 * Bare `/search` (no `?q=`): the load body returns the empty payload
 * synchronously per clarifications Q-5 — avoids a per-route `routeMeta`
 * toggle that would break the `injectLoad<typeof load>()` type contract.
 * Empty payload is < 1 KB gz; no payload-size concern.
 *
 * Authority:
 * - DR-14 §"Decision" + §"Implementation pivot 2026-05-04"
 * - `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe`
 * - clarifications.md Q-5 (bare-search empty-payload contract),
 *   §1.13 (page-size cap), §1.19 (Translatable JSONB pre-resolution scoped
 *   under §1.11; remediation gated by the per-route SSR HTML payload size
 *   verifier shipped in SH6)
 */

const PAGE_SIZE = 24;

type SearchSortField = 'createdAt' | 'price' | 'name' | 'rating' | 'relevance';
const SEARCH_SORT_FIELDS: ReadonlySet<SearchSortField> = new Set<SearchSortField>([
  'createdAt',
  'price',
  'name',
  'rating',
  'relevance',
]);

function isSearchSortField(value: string | null): value is SearchSortField {
  return value !== null && (SEARCH_SORT_FIELDS as ReadonlySet<string>).has(value);
}

export interface SearchLoadPayload {
  /**
   * Always echoes the trimmed `?q=` value (or empty string when absent) so
   * the component can seed its `query` signal synchronously without a
   * second URL parse on hydrate.
   */
  query: string;
  hits: SearchHit[];
  totalCount: number;
  /** True when `/v1/search` failed. Distinguishes an outage from no matches. */
  hitsError?: boolean;
  facets: FiltersResponse;
}

function readNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const load = async ({
  params: routeParams,
  event,
}: PageServerLoad): Promise<SearchLoadPayload> => {
  const params = loaderSearchParams(event.node.req as ServerRequest);
  const trimmed = (params.get('q') ?? '').trim();

  // Bare-search short-circuit per clarifications Q-5. The empty-state template
  // does not need any API data — the component renders the no-results CTA
  // pointing at the locale home directly.
  if (!trimmed) {
    return {
      query: '',
      hits: [],
      totalCount: 0,
      facets: [],
    };
  }

  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(routeParams) },
  );

  const searchQuery: Record<string, string | number | boolean | undefined> = {
    ['q']: trimmed,
    ['page']: readNumber(params.get('page')) ?? 1,
    ['pageSize']: PAGE_SIZE,
  };
  const sortBy = params.get('sortBy');
  if (isSearchSortField(sortBy)) searchQuery['sortBy'] = sortBy;
  const sortOrder = params.get('sortOrder');
  if (sortOrder === 'asc' || sortOrder === 'desc') searchQuery['sortOrder'] = sortOrder;
  const brand = params.get('brand');
  if (brand) searchQuery['brand'] = brand;
  const minPrice = readNumber(params.get('minPrice'));
  if (minPrice !== undefined) searchQuery['priceMin'] = minPrice;
  const maxPrice = readNumber(params.get('maxPrice'));
  if (maxPrice !== undefined) searchQuery['priceMax'] = maxPrice;

  /**
   * Search results + facets fetch in parallel. Both are soft-fail per
   * `agent_docs/storefront/ssr-data-loading.md` `## Error handling` —
   * an empty results grid with the search heading + facets fallback beats
   * a 500 page when one of the two endpoints has a partial outage.
   */
  const [results, facets] = await Promise.all([
    apiClient
      .get<ApiResponse<SearchHit[]> & { meta: PaginationMeta }>('/v1/search', {
        query: searchQuery,
      })
      .then((r) => ({
        data: r.data,
        total: r.meta?.total ?? r.data.length,
        failed: false,
      }))
      // Still soft-fail, but carry the failure. Mapping an outage to an empty
      // set told the shopper their query matched nothing (finding C10).
      .catch<{ data: SearchHit[]; total: number; failed: boolean }>(() => ({
        data: [],
        total: 0,
        failed: true,
      })),
    apiClient
      .get<ApiResponse<FiltersResponse>>('/v1/search/filters', { query: { q: trimmed } })
      .then((r) => r.data)
      .catch<FiltersResponse>(() => []),
  ]);

  return {
    query: trimmed,
    hits: results.data,
    totalCount: results.total,
    hitsError: results.failed,
    facets,
  };
};
