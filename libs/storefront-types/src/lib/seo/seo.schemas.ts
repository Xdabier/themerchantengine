import { z } from 'zod';

/**
 * Storefront SEO surfaces. The API serves sitemap / robots / llms.txt as raw
 * payloads (NOT wrapped in `{ data }`), see
 * `apps/api/src/modules/seo/seo-storefront.controller.ts` and
 * `apps/api/src/modules/geo/geo-storefront.controller.ts`. The storefront's
 * proxy server routes echo these payloads byte-for-byte at `/sitemap.xml`,
 * `/robots.txt`, `/llms.txt` (S13).
 *
 * The schemas here describe the proxy passthrough wrappers used by the
 * storefront server routes — payload + content-type pair. They are NOT
 * envelope-wrapped.
 */

export const sitemapPayloadSchema = z.object({
  contentType: z.string(),
  body: z.string().min(1),
});
export type SitemapPayload = z.infer<typeof sitemapPayloadSchema>;

export const robotsPayloadSchema = z.object({
  contentType: z.literal('text/plain; charset=utf-8'),
  body: z.string().min(1),
});
export type RobotsPayload = z.infer<typeof robotsPayloadSchema>;

export const llmsPayloadSchema = z.object({
  contentType: z.literal('text/plain; charset=utf-8'),
  body: z.string().min(1),
});
export type LlmsPayload = z.infer<typeof llmsPayloadSchema>;
