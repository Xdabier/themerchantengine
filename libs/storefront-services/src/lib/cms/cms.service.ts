import { Inject, Injectable } from '@angular/core';
import * as z from 'zod';

import {
  apiResponseSchema,
  cmsPageListResponseSchema,
  cmsPageSchema,
  type CmsPage,
} from '@storefront-types';

import {
  STOREFRONT_API_CLIENT,
  type ApiClient,
  type RequestOptions,
} from '../shared/api-client.token';

/**
 * Storefront CMS service. Wraps `GET /v1/pages/:slug(*)` for the about + policy
 * surfaces (and any future CMS-backed public route).
 *
 * The slug parameter carries a leading `/` (e.g. `/about`, `/privacy-policy`)
 * to match the storefront route ↔ CMS slug map declared at
 * `apps/storefront/src/app/pages/[locale]/policies/[slug].server.ts`. The
 * controller at `apps/api/src/modules/cms/cms.controller.ts:42` mounts the
 * route as `:slug(*)` so any prefix segments after `/v1/pages` are forwarded
 * verbatim — passing `/about` resolves to `/v1/pages/about`.
 *
 * Per clarifications §1.20: the CMS payload is already locale-resolved by the
 * global `TranslatableInterceptor` on the API side, so `title` / `content` /
 * `metaTitle?` / `metaDescription?` arrive as plain strings. The SSR companion
 * does not need to do any `pickTranslation()` work.
 */
@Injectable({ providedIn: 'root' })
export class CmsService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  /**
   * Every published page, ordered by `sortOrder`. Titles arrive already
   * resolved for the request locale by the API's Translatable interceptor, so
   * the caller renders them as-is.
   */
  async listPages(options?: RequestOptions): Promise<CmsPage[]> {
    const envelope = await this.api.get<unknown>('/v1/pages', options);
    return cmsPageListResponseSchema.parse(envelope).data;
  }

  async getPageBySlug(slug: string): Promise<CmsPage> {
    z.string().min(1).startsWith('/').parse(slug);
    const envelope = await this.api.get<unknown>(`/v1/pages${slug}`);
    return apiResponseSchema(cmsPageSchema).parse(envelope).data;
  }
}
