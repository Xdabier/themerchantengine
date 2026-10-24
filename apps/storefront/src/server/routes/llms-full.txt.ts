import { defineEventHandler } from 'h3';

import { proxyTextSurface } from '../proxy-seo';

/**
 * `/llms-full.txt` — proxies `GET /v1/llms-full.txt` from the API. Comprehensive
 * Markdown dump of the catalogue (every active product with descriptions,
 * brands, SKUs, prices; every visible category; full policy bodies),
 * optimised for AI-inference layers that ingest the entire store in one
 * request. Locale-aware via `Accept-Language` per the llms.txt convention.
 *
 * The hyphen filename is canonical per the llmstxt.org "expanded content"
 * convention; the underscore variant `/llms_full.txt` 301s here.
 */
export default defineEventHandler(async (event) => {
  return proxyTextSurface(event, {
    upstreamPath: '/v1/llms-full.txt',
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'public, max-age=600, s-maxage=21600',
    forwardAcceptLanguage: true,
  });
});
