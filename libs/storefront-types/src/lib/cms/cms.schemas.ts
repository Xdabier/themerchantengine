import * as z from 'zod';

import { apiResponseSchema } from '../shared/envelope';

/**
 * Storefront CMS schemas — single page payload returned by `GET /v1/pages/:slug(*)`.
 *
 * The API stores `title` / `content` / `metaTitle` / `metaDescription` as
 * Translatable JSONB on `model CmsPage` (`prisma/schema.prisma:1426-1448`).
 * The global `TranslatableInterceptor` registered at `apps/api/src/main.ts:97`
 * resolves them per inbound `Accept-Language`, so by the time the storefront
 * sees the payload these fields are plain `string` (or `null` for the optional
 * meta fields when the editor left them blank).
 *
 * SH1's `createServerApiClient` proxies the URL-prefix-derived locale (`/fr/*`
 * → `fr`) into `Accept-Language`, so the SSR companion does not need to do any
 * per-payload `pickTranslation()` work — the §1.19 deferral does NOT extend to
 * CMS payloads. See clarifications §1.20.
 *
 * The `slug` field carries a leading `/` (e.g. `/about`, `/privacy-policy`)
 * because the API endpoint mounts at `:slug(*)` and the controller prepends
 * the slash before the lookup (see `apps/api/src/modules/cms/cms.controller.ts:42`).
 */

export const cmsPageTypeSchema = z.enum(['STATIC', 'POLICY', 'LANDING']);
export type CmsPageType = z.infer<typeof cmsPageTypeSchema>;

export const cmsPageSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  type: cmsPageTypeSchema,
  title: z.string(),
  content: z.string(),
  metaTitle: z.string().nullable().optional(),
  metaDescription: z.string().nullable().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  showInNavigation: z.boolean().optional(),
  template: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type CmsPage = z.infer<typeof cmsPageSchema>;

export const cmsPageResponseSchema = apiResponseSchema(cmsPageSchema);

/**
 * `GET /v1/pages` returns every published page ordered by `sortOrder`, as a
 * plain array rather than a paginated envelope. The footer navigation reads it
 * to surface pages the storefront has no dedicated route for.
 */
export const cmsPageListResponseSchema = apiResponseSchema(z.array(cmsPageSchema));
