import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * In Vite dev mode Analog mounts its Nitro middleware only at `/api`, so every
 * `src/server/routes/*.ts` surface falls through to the Angular SSR renderer
 * and answers 200 with the SPA shell. The dev server therefore needs an
 * explicit proxy entry per surface, hand-maintained beside the route files.
 *
 * `sitemap-pages.xml` had a route file and no proxy entry. Nothing noticed:
 * the path answered 200 in dev and in the whole e2e suite, just with HTML, so
 * any spec asserting only a status code passed against a page that served no
 * sitemap at all. This guard pins the parity for the sitemap surfaces rather
 * than trusting the two lists to be edited together.
 */

const ROUTES_DIR = resolve(__dirname, '..', 'routes');

function sitemapRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.startsWith('sitemap') && name.endsWith('.ts'))
    .map((name) => name.replace(/\.ts$/, ''));
}

/**
 * Read as source rather than imported: `vite.config.ts` pulls in the Analog
 * plugin chain, which does not load under the jsdom test environment.
 */
function devProxyKeys(): string[] {
  const source = readFileSync(resolve(__dirname, '..', '..', '..', 'vite.config.ts'), 'utf-8');
  return [...source.matchAll(/^\s*'(\/[^']+)':\s*\{$/gm)].map((m) => m[1]);
}

describe('dev-server SEO proxy parity', () => {
  it('finds the sitemap route files it is meant to guard', () => {
    // Without this the whole suite passes vacuously on an empty directory read.
    expect(sitemapRouteFiles().length).toBeGreaterThanOrEqual(4);
  });

  it('proxies every sitemap surface the Nitro routes serve', () => {
    const proxied = new Set(devProxyKeys());
    const missing = sitemapRouteFiles().filter((surface) => !proxied.has(`/${surface}`));
    expect(missing, 'sitemap routes that answer with the SPA shell in dev').toEqual([]);
  });
});
