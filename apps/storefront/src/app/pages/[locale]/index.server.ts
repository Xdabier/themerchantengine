import type { PageServerLoad } from '@analogjs/router';
import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type { ApiResponse, Category, ProductSummary, StorefrontSection } from '@storefront-types';

import { createServerApiClient } from '../../../server/server-api-client-factory';
import { routeLocale } from '../../../lib/locale';

/**
 * Page server endpoint for `/[locale]/`. Migrates the home page from a
 * browser-only `hydrate()` chain to the Analog page-server-endpoint pattern
 * established at SH2 (see `agent_docs/storefront/ssr-data-loading.md`
 * `## Per-page recipe`). Closes Defect B — the empty-section flash on the
 * first paint of the home route — by fetching every primary content source on
 * the SSR pass so the configured sections appear in the SSR HTML payload.
 *
 * The companion runs as a Nitro endpoint OUTSIDE the Angular SSR DI graph;
 * it cannot inject `CategoriesService` / `ProductsService` / `SectionsService`,
 * so it builds a per-request `ApiClient` from the inbound h3 event via the
 * SH1 `createServerApiClient(req, res)` helper (constitution §3.14 SSOT).
 *
 * Authority:
 * - DR-14 §"Decision" + §"Implementation pivot 2026-05-04"
 * - `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe`
 * - clarifications.md §1.11 (translatables), §1.17 (Option A pivot)
 */

const FEATURED_FETCH_MAX = 24;

/**
 * Collect every productId referenced by a FEATURED_PRODUCTS section so the
 * loader can fetch that exact set by id. Curated picks resolve against this
 * fetch alone: phase B2 removed the just-arrived / popular pool fallback that
 * used to dress an unresolvable id up as a full rail.
 */
function collectFeaturedProductIds(sections: StorefrontSection[]): string[] {
  const ids = new Set<string>();
  for (const s of sections) {
    if (s.type !== 'FEATURED_PRODUCTS') continue;
    const pid = (s.config as { productIds?: unknown }).productIds;
    if (Array.isArray(pid)) for (const id of pid) if (typeof id === 'string') ids.add(id);
  }
  return [...ids].slice(0, FEATURED_FETCH_MAX);
}

export interface HomeLoadPayload {
  categories: Category[];
  /**
   * Visible operator-managed `StorefrontSection` rows for the `home` slug.
   * Empty array when the sections fetch soft-fails, which renders a home with
   * no section blocks rather than a 500.
   */
  sections: StorefrontSection[];
  /**
   * Products referenced by `FEATURED_PRODUCTS` sections, fetched by id so the
   * curated rails render the operator's exact picks. Empty when no curated
   * rails exist, or when none of the configured ids resolve.
   */
  featured: ProductSummary[];
}

type SectionsEnvelope = { data: StorefrontSection[] };

export const load = async ({ params, event }: PageServerLoad): Promise<HomeLoadPayload> => {
  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(params) },
  );

  /**
   * Categories + home sections first.
   * - Categories are primary content (drive the grid + the CATEGORY_SHOWCASE
   *   block). Hard-fail: a rejection here propagates a 500 so the user sees the
   *   `[locale]/error.page.ts` shell instead of a structurally-broken page.
   * - Sections are soft-fail (`.catch(() => [])`) — the page renders without
   *   section blocks rather than 500ing on a single API path.
   * Resolved before the rails so the curated FEATURED_PRODUCTS ids are known.
   */
  const [categoriesEnvelope, sections] = await Promise.all([
    apiClient.get<ApiResponse<Category[]>>('/v1/categories'),
    apiClient
      .get<SectionsEnvelope>('/v1/storefront/sections/home')
      .then((r) => r.data)
      .catch<StorefrontSection[]>(() => []),
  ]);
  const categories = categoriesEnvelope.data;
  const featuredIds = collectFeaturedProductIds(sections);

  /**
   * Curated FEATURED_PRODUCTS picks, fetched by id. Soft-fail per
   * `agent_docs/storefront/ssr-data-loading.md` `## Error handling` — a partial
   * home page beats a 500 when a single API path is down.
   */
  const featured = featuredIds.length
    ? await apiClient
        .get<ApiResponse<ProductSummary[]>>('/v1/products', {
          query: { ids: featuredIds.join(','), pageSize: Math.min(featuredIds.length, 100) },
        })
        .then((r) => r.data)
        .catch<ProductSummary[]>(() => [])
    : [];

  return {
    categories,
    sections,
    featured,
  };
};
