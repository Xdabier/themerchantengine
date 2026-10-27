import { defineEventHandler, sendRedirect, setResponseHeader } from 'h3';

/**
 * `/llms_full.txt` — alias for the underscore variant some AI crawlers probe
 * (the llmstxt.org spec uses the hyphen form `/llms-full.txt` as canonical).
 * 301-redirect rather than dual-serving so the canonical URL accumulates the
 * crawl budget and CDN cache. Mirrors the `/sitemap.xml` → `/sitemap_index.xml`
 * pattern at `apps/storefront/src/server/routes/sitemap.xml.ts`.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400');
  await sendRedirect(event, '/llms-full.txt', 301);
});
