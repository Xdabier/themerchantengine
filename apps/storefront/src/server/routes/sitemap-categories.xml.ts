import { defineEventHandler } from 'h3';

import { proxyTextSurface } from '../proxy-seo';

/**
 * `/sitemap-categories.xml` — proxies `GET /v1/sitemap-categories.xml`
 * from the API. Per-page sub-sitemap referenced by the index sitemap
 * (per `docs/storefront-api-reference.md:1150-1154`).
 */
export default defineEventHandler(async (event) => {
  return proxyTextSurface(event, {
    upstreamPath: '/v1/sitemap-categories.xml',
    contentType: 'application/xml; charset=utf-8',
    cacheControl: 'public, max-age=300, s-maxage=3600',
  });
});
