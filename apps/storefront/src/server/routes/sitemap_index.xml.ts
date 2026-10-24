import { defineEventHandler } from 'h3';

import { proxyTextSurface } from '../proxy-seo';

/**
 * `/sitemap_index.xml` — proxies `GET /v1/sitemap_index.xml` from the API.
 * Authority: `docs/storefront-api-reference.md` §"SEO" (lines 1132-1135) +
 * `agent_docs/storefront/seo-geo.md:15` ("Sitemap proxied from
 * GET /v1/sitemap.xml (API)") — the API serves the sitemap as raw XML
 * with a 1 h Redis cache; the storefront edge mirrors that cache window.
 */
export default defineEventHandler(async (event) => {
  return proxyTextSurface(event, {
    upstreamPath: '/v1/sitemap_index.xml',
    contentType: 'application/xml; charset=utf-8',
    cacheControl: 'public, max-age=300, s-maxage=3600',
  });
});
