import { defineEventHandler } from 'h3';

import { proxyTextSurface } from '../proxy-seo';

/**
 * `/llms.txt` — proxies `GET /v1/llms.txt` from the API. Markdown
 * summary of the store, served as `text/plain` per the llms.txt spec
 * referenced in `docs/organic-acquisition-research-2026.md:139-155`.
 * The API caches for 6 h (`docs/storefront-api-reference.md:1173`); the
 * storefront edge mirrors the longer cache window.
 */
export default defineEventHandler(async (event) => {
  return proxyTextSurface(event, {
    upstreamPath: '/v1/llms.txt',
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'public, max-age=600, s-maxage=21600',
    forwardAcceptLanguage: true,
  });
});
