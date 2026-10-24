import { defineEventHandler } from 'h3';

import { proxyTextSurface } from '../proxy-seo';

/**
 * `/robots.txt` — proxies `GET /v1/robots.txt` from the API. The API
 * serves a locale-agnostic file (allowlist + sitemap pointer per
 * `agent_docs/storefront/seo-geo.md:46-65`) with a 1 h Redis cache.
 * Storefront edge mirrors the cache window.
 */
export default defineEventHandler(async (event) => {
  return proxyTextSurface(event, {
    upstreamPath: '/v1/robots.txt',
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'public, max-age=300, s-maxage=3600',
  });
});
