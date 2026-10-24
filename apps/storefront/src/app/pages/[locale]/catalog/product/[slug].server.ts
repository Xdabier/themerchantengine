import { createError } from 'h3';
import type { PageServerLoad } from '@analogjs/router';
import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type {
  ApiResponse,
  ProductDetail,
  ProductSummary,
  Question,
  RatingSummary,
  Review,
} from '@storefront-types';

import { createServerApiClient } from '../../../../../server/server-api-client-factory';
import { readErrorStatus } from '../../../../../server/server-companion-helpers';
import { routeLocale } from '../../../../../lib/locale';

/**
 * Page server endpoint for `/[locale]/catalog/product/[slug]`. Analog's
 * Vite-Nitro plugin auto-wraps the `load` export with a `defineEventHandler`
 * (see `node_modules/@analogjs/vite-plugin-nitro/src/lib/plugins/page-endpoints.js`)
 * and exposes the result at `/api/_analog/<route>`. The Analog router
 * resolver fetches that endpoint via HTTP on every navigation; the
 * component reads the JSON response via `injectLoad<typeof load>()`.
 *
 * The companion runs as a Nitro endpoint OUTSIDE the Angular SSR DI graph,
 * so it cannot inject `ProductsService` / `ReviewsService` etc. Instead it
 * builds a per-request `ApiClient` from the inbound h3 event and calls the
 * storefront API directly. Mirrors the SH1 `STOREFRONT_API_CLIENT` provider
 * contract for cookie / locale / X-Request-Id / Set-Cookie pipe so the SSR
 * data path stays consistent with the Angular-SSR-DI consumers (chrome,
 * future-authed widgets) that the SH1 provider serves.
 *
 * Authority:
 * - DR-14 §"Decision" + §"Implementation pivot 2026-05-04"
 * - `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe`
 * - clarifications.md §1.17 (Option A pivot)
 *
 * Closes Defect A — without this load running on the SSR pass the product
 * detail page emits no `og:image`, so JS-less crawlers (WhatsApp, LinkedIn,
 * Facebook, AI bots) cache the favicon as the share-card image for ~7 days.
 */

const REVIEWS_PAGE_SIZE = 3;
const QUESTIONS_PAGE_SIZE = 3;
const RELATED_PAGE_SIZE = 4;
const VARIANT_WIDTH_FLOOR = 200;

export interface ProductDetailLoadPayload {
  product: ProductDetail;
  reviewSummary: RatingSummary | null;
  firstReviews: Review[];
  questions: Question[];
  /** Published questions on the product, not just the seeded page. */
  questionsTotal: number;
  related: ProductSummary[];
}

/**
 * Drop the smallest (`thumbnail` ~96px) asset variants from each asset's
 * `assetVariants` array. The product detail page consumes only `small`
 * (~400px), `medium` (~800px), and `large` (~1600px) widths via the
 * `pictureSourcesFromAssetVariants` helper — thumbnails would never reach
 * the DOM, only the SSR HTML payload size. Per clarifications §1.12 +
 * `agent_docs/storefront/ssr-data-loading.md` `## Payload size budget`.
 */
function stripUnusedVariants<A extends { assetVariants?: unknown }>(asset: A): A {
  if (!Array.isArray(asset.assetVariants)) return asset;
  const filtered = (asset.assetVariants as Array<{ width?: number }>).filter(
    (v) => typeof v?.width === 'number' && v.width >= VARIANT_WIDTH_FLOOR,
  );
  return { ...asset, assetVariants: filtered };
}

function stripProductForSsr(product: ProductDetail): ProductDetail {
  return {
    ...product,
    assets: product.assets?.map(stripUnusedVariants),
    primaryAsset: product.primaryAsset
      ? stripUnusedVariants(product.primaryAsset)
      : product.primaryAsset,
  };
}

export const load = async ({
  params,
  event,
}: PageServerLoad): Promise<ProductDetailLoadPayload> => {
  const slug = String(params?.['slug'] ?? '');
  if (!slug) {
    throw createError({ statusCode: 404, statusMessage: 'Product not found' });
  }

  /**
   * SH2 Nit 2 — reuse the SH1 SSR-API-client factory rather than re-implement
   * the inbound-event → RequestContext build inline. Same factory the Angular
   * SSR-DI provider at `apps/storefront/src/app/app.config.server.ts:43` uses,
   * keeping the SSR data path single-sourced (constitution §3.14). h3's
   * `event.node.req` is Node's `IncomingMessage`; Analog's `ServerRequest`
   * narrows it with `originalUrl: string`, which h3 sets at runtime — the
   * cast aligns the static type with the runtime guarantee.
   */
  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(params) },
  );

  let product: ProductDetail;
  try {
    const envelope = await apiClient.get<ApiResponse<ProductDetail>>(
      `/v1/products/${encodeURIComponent(slug)}`,
    );
    product = envelope.data;
  } catch (err) {
    if (readErrorStatus(err) === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Product not found' });
    }
    throw err;
  }

  const primaryCategory = product.categories?.[0]?.category;

  const [reviewSummary, firstReviews, questions, related] = await Promise.all([
    apiClient
      .get<ApiResponse<RatingSummary>>(`/v1/products/${encodeURIComponent(slug)}/reviews/summary`)
      .then((r) => r.data)
      .catch<RatingSummary | null>(() => null),
    apiClient
      .get<ApiResponse<Review[]>>(`/v1/products/${encodeURIComponent(slug)}/reviews`, {
        query: {
          pageSize: REVIEWS_PAGE_SIZE,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        },
      })
      .then((r) => r.data.slice(0, REVIEWS_PAGE_SIZE))
      .catch<Review[]>(() => []),
    apiClient
      // `meta.total` is what tells the page whether more published questions
      // exist than the ones it seeds, which is what gates "Show more".
      .get<ApiResponse<Question[]> & { meta?: { total?: number } }>(
        `/v1/products/${encodeURIComponent(slug)}/questions`,
        { query: { pageSize: QUESTIONS_PAGE_SIZE } },
      )
      .then((r) => ({
        data: r.data.slice(0, QUESTIONS_PAGE_SIZE),
        total: r.meta?.total ?? r.data.length,
      }))
      .catch<{ data: Question[]; total: number }>(() => ({ data: [], total: 0 })),
    primaryCategory
      ? apiClient
          .get<ApiResponse<ProductSummary[]>>('/v1/products', {
            query: { categoryId: primaryCategory.id, pageSize: RELATED_PAGE_SIZE + 1 },
          })
          .then((r) => r.data)
          .catch<ProductSummary[]>(() => [])
      : Promise.resolve<ProductSummary[]>([]),
  ]);

  return {
    product: stripProductForSsr(product),
    reviewSummary,
    firstReviews,
    questions: questions.data,
    questionsTotal: questions.total,
    related,
  };
};
