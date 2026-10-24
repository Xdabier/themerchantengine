import { defineEventHandler } from 'h3';

import { proxyTextSurface } from '../proxy-seo';

/**
 * `/sitemap-pages.xml` — proxies `GET /v1/sitemap-pages.xml` from the API.
 * The third sub-sitemap referenced by `<sitemapindex>` (CMS pages + static
 * about/policies). Was emitted by `seo.service.ts:493` but never routed —
 * crawlers fetching it landed on the SPA shell. Restored alongside the
 * `STOREFRONT_PUBLIC_BASE_URL` SEO base-URL fix.
 */
export default defineEventHandler(async (event) => {
  return proxyTextSurface(event, {
    upstreamPath: '/v1/sitemap-pages.xml',
    contentType: 'application/xml; charset=utf-8',
    cacheControl: 'public, max-age=300, s-maxage=3600',
  });
});
