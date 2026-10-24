import { defineEventHandler } from 'h3';

import { proxyTextSurface } from '../proxy-seo';

/**
 * `/sitemap-products.xml` — proxies `GET /v1/sitemap-products.xml` from
 * the API. Per-page sub-sitemap referenced by the index sitemap (per
 * `docs/storefront-api-reference.md:1144-1148`).
 */
export default defineEventHandler(async (event) => {
  return proxyTextSurface(event, {
    upstreamPath: '/v1/sitemap-products.xml',
    contentType: 'application/xml; charset=utf-8',
    cacheControl: 'public, max-age=300, s-maxage=3600',
  });
});
