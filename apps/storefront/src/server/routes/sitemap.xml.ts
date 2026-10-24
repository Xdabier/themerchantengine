import { defineEventHandler, sendRedirect, setResponseHeader } from 'h3';

/**
 * `/sitemap.xml` — 301 alias to `/sitemap_index.xml`. Mirrors the API
 * behavior (`docs/storefront-api-reference.md:1138-1142` — "GET
 * /v1/sitemap.xml ... 301 Moved Permanently to /v1/sitemap_index.xml").
 * Crawlers that hard-code `/sitemap.xml` reach the index sitemap via the
 * permanent redirect.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400');
  await sendRedirect(event, '/sitemap_index.xml', 301);
});
