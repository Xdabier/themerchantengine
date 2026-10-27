import { createError } from 'h3';
import type { PageServerLoad } from '@analogjs/router';
import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type { ApiResponse, CmsPage } from '@storefront-types';

import { createServerApiClient } from '../../../server/server-api-client-factory';
import { readErrorStatus } from '../../../server/server-companion-helpers';
import { routeLocale } from '../../../lib/locale';

/**
 * Page server endpoint for `/[locale]/about`. Migrates the About surface from
 * a static-i18n template to a CMS-backed SSR pull via `GET /v1/pages/about`.
 * Closes AC-5 (about row): the resolved title + body land in the SSR HTML
 * payload so JS-less crawlers index the localised brand-voiced copy on first
 * byte.
 *
 * Per clarifications §1.20: the API resolves Translatable JSONB to plain
 * strings via the global `TranslatableInterceptor` (see
 * `apps/api/src/main.ts:97`) using the inbound `Accept-Language` that the SH1
 * `createServerApiClient` sets from the matched `[locale]` route param
 * (`routeLocale(params)`, the SSR data-fetch locale SSOT — NOT the URL prefix,
 * which at the Nitro page-endpoint layer is the internal `/api/_analog/...`
 * path). The SH4 §1.19 pre-resolution deferral does NOT extend to CMS payloads.
 *
 * Authority:
 * - DR-14 §"Decision" + §"Implementation pivot 2026-05-04"
 * - `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe`
 * - clarifications.md §1.20 (CMS-backed audit), §1.17 (Option A pivot)
 */

const ABOUT_CMS_SLUG = '/about';

export interface AboutLoadPayload {
  page: CmsPage;
}

export const load = async ({ params, event }: PageServerLoad): Promise<AboutLoadPayload> => {
  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(params) },
  );

  /**
   * About is primary content — the page exists to surface the brand-voiced
   * "Our Story" copy. Hard 404 throw on miss propagates 404 to the response
   * and renders the `[locale]/[...not-found].page.ts` shell instead of a
   * blank section. Per `agent_docs/storefront/ssr-data-loading.md`
   * `## Error handling`.
   */
  try {
    const envelope = await apiClient.get<ApiResponse<CmsPage>>(`/v1/pages${ABOUT_CMS_SLUG}`);
    return { page: envelope.data };
  } catch (err) {
    if (readErrorStatus(err) === 404) {
      throw createError({ statusCode: 404, statusMessage: 'About page not found' });
    }
    throw err;
  }
};
