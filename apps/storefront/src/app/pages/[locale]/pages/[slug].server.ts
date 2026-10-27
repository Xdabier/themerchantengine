import { createError } from 'h3';
import type { PageServerLoad } from '@analogjs/router';
import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type { ApiResponse, CmsPage } from '@storefront-types';

import { createServerApiClient } from '../../../../server/server-api-client-factory';
import { readErrorStatus } from '../../../../server/server-companion-helpers';
import { isLegacyCmsSlug } from '../../../../lib/routes';
import { routeLocale } from '../../../../lib/locale';

/**
 * Page server endpoint for `/[locale]/pages/[slug]` — the generic CMS surface.
 *
 * Before this route a page published in the admin had nowhere to render: only
 * `/about` and the four `/policies/*` slugs had storefront routes, so every
 * other published page 404'd at every URL a customer could try, and the pages
 * sitemap advertised URLs that were never served.
 *
 * Single-segment slugs only. The admin DTO permits multi-segment slugs
 * (`apps/api/src/modules/cms/dto/create-page.dto.ts`), but an Analog `[slug]`
 * route matches one segment; the pages sitemap skips the rest rather than
 * advertising a URL nothing serves.
 *
 * Locale comes from `routeLocale(params)`, not from the request URL: at the
 * Nitro page-endpoint layer the URL is the internal `/api/_analog/...` path.
 */

export interface CmsPageLoadPayload {
  /** The route segment, without the leading slash the API stores. */
  slug: string;
  page: CmsPage;
}

export const load = async ({ params, event }: PageServerLoad): Promise<CmsPageLoadPayload> => {
  const slug = String(params?.['slug'] ?? '').trim();

  if (!slug) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found' });
  }

  /**
   * The five slugs that own a dedicated route are rejected here rather than
   * served twice: `/pages/about` would be a duplicate-content twin of
   * `/about`, and the footer mapper never links it (`cmsPageRoute`).
   */
  if (isLegacyCmsSlug(slug)) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found' });
  }

  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(params) },
  );

  try {
    const envelope = await apiClient.get<ApiResponse<CmsPage>>(`/v1/pages/${slug}`);
    return { slug, page: envelope.data };
  } catch (err) {
    if (readErrorStatus(err) === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Page not found' });
    }
    throw err;
  }
};
