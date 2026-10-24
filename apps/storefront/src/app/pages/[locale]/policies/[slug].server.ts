import { createError } from 'h3';
import type { PageServerLoad } from '@analogjs/router';
import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type { ApiResponse, CmsPage } from '@storefront-types';

import { createServerApiClient } from '../../../../server/server-api-client-factory';
import { readErrorStatus } from '../../../../server/server-companion-helpers';
import { isPolicySlug, type PolicySlug } from '../../../../lib/routes';
import { routeLocale } from '../../../../lib/locale';

/**
 * Page server endpoint for `/[locale]/policies/[slug]`. Migrates the four
 * policy surfaces (privacy / returns / terms / shipping) from static i18n
 * templates to a CMS-backed SSR pull via `GET /v1/pages/:cmsSlug`.
 * Closes AC-5 (policies row): the resolved title + content land in the SSR
 * HTML so JS-less crawlers index the localised legal copy on first byte.
 *
 * Per clarifications §1.20: three of the four storefront slugs do not match
 * the CMS slug (the existing seed uses `/privacy-policy`, `/return-policy`,
 * `/shipping-info`). The map below closes the mismatch storefront-side
 * rather than via a backend rename + admin URL break.
 *
 * Authority:
 * - DR-14 §"Decision" + §"Implementation pivot 2026-05-04"
 * - `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe`,
 *   `## Error handling` (hard 404 on miss)
 * - clarifications.md §1.20 (CMS-backed audit + slug map), §1.17 (Option A)
 */

const POLICY_SLUG_MAP: Record<PolicySlug, string> = {
  privacy: '/privacy-policy',
  returns: '/return-policy',
  terms: '/terms',
  shipping: '/shipping-info',
};

export interface PolicyLoadPayload {
  slug: PolicySlug;
  page: CmsPage;
}

export const load = async ({ params, event }: PageServerLoad): Promise<PolicyLoadPayload> => {
  const raw = String(params?.['slug'] ?? '');

  // Fast-fail before the API roundtrip on unknown slugs — mirrors the
  // pre-existing `isPolicySlug` allowlist guard in the component, with the
  // storefront `[locale]/[...not-found].page.ts` shell handling the 404.
  if (!isPolicySlug(raw)) {
    throw createError({ statusCode: 404, statusMessage: 'Policy not found' });
  }
  const slug: PolicySlug = raw;
  const cmsSlug = POLICY_SLUG_MAP[slug];

  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(params) },
  );

  /**
   * Policy body is primary content. Hard 404 throw on miss propagates 404 to
   * the response and renders the `[locale]/[...not-found].page.ts` shell
   * instead of rendering a section with empty title / body.
   */
  try {
    const envelope = await apiClient.get<ApiResponse<CmsPage>>(`/v1/pages${cmsSlug}`);
    return { slug, page: envelope.data };
  } catch (err) {
    if (readErrorStatus(err) === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Policy not found' });
    }
    throw err;
  }
};
