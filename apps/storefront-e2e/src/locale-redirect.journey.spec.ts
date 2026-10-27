import { expect, test } from '@playwright/test';

import { activeStoreConfigFixture, attachConsoleBaseline, type ConsoleBaseline } from './support';

/** The locale this fixture falls back to with no cookie and no supported header match. */
const DEFAULT_LOCALE = activeStoreConfigFixture().localization.defaultLocale;

/**
 * Phase S22 — B1 root locale redirect (Nitro middleware).
 *
 * Asserts that requests to `/` are 302-redirected to `/{locale}/` based on
 * the `storefront_locale` cookie (when set) or `Accept-Language` header
 * (fallback), and that a first path segment shaped like a language tag but
 * outside the supported set is 301-redirected onto the default locale rather
 * than rendering the default page under a 200. Hits the real Nitro middleware
 * at `apps/storefront/src/server/middleware/locale-redirect.ts`, no fixtures.
 */

test.describe('storefront S22 — B1 root locale redirect', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test('Accept-Language: fr-QA → /fr/', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({
      baseURL,
      // The retired `ar` leads the list at a higher q-value than `en`. It must
      // be skipped outright, leaving `fr-QA` as the highest supported tag.
      extraHTTPHeaders: { 'Accept-Language': 'ar,fr-QA;q=0.9,en;q=0.5' },
    });
    const res = await ctx.get('/', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toBe('/fr/');
    await ctx.dispose();
  });

  test('Accept-Language: en → /en/', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const res = await ctx.get('/', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toBe('/en/');
    await ctx.dispose();
  });

  test('storefront_locale cookie wins over a conflicting Accept-Language header', async ({
    playwright,
    baseURL,
  }) => {
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'storefront_locale=fr',
      },
    });
    const res = await ctx.get('/', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toBe('/fr/');
    await ctx.dispose();
  });

  test('a storefront_locale cookie holding the retired ar value is ignored', async ({
    playwright,
    baseURL,
  }) => {
    // A visitor who chose Arabic before the locale flip still carries the old
    // cookie. It must not resolve: the header decides instead, so this lands
    // on /en/ rather than on the default locale.
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'storefront_locale=ar',
      },
    });
    const res = await ctx.get('/', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toBe('/en/');
    await ctx.dispose();
  });

  test(`default-locale fallback (no header, no cookie) → /${DEFAULT_LOCALE}/`, async ({
    playwright,
    baseURL,
  }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const res = await ctx.get('/', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toBe(`/${DEFAULT_LOCALE}/`);
    await ctx.dispose();
  });

  test('non-/ paths are not redirected by the locale middleware', async ({
    playwright,
    baseURL,
  }) => {
    const ctx = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'Accept-Language': 'fr-QA' },
    });
    const res = await ctx.get('/en/', { maxRedirects: 0 });
    expect([200, 304]).toContain(res.status());
    await ctx.dispose();
  });

  // ── Unsupported locale segments ─────────────────────────────────────────

  // Without the middleware's unsupported-locale branch, `/de/catalog` matched
  // the Analog `[locale]` route, `routeLocale()` failed to recognise the
  // segment, and the page rendered the DEFAULT locale under a 200. That
  // advertises an unbounded set of duplicate URLs to a crawler. The contract is
  // a 301 onto the default locale, never a 200 on the unknown segment.
  for (const unsupported of ['zz', 'de', 'ar']) {
    test(`/${unsupported}/catalog 301s to /${DEFAULT_LOCALE}/catalog instead of rendering it`, async ({
      request,
    }) => {
      const res = await request.get(`/${unsupported}/catalog`, { maxRedirects: 0 });
      expect(res.status(), `/${unsupported}/catalog must not render a page`).toBe(301);
      expect(res.headers()['location']).toBe(`/${DEFAULT_LOCALE}/catalog`);
    });
  }

  test('the retired ar segment carries its path AND query onto the default locale', async ({
    request,
  }) => {
    const res = await request.get('/ar/search?q=audio', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toBe(`/${DEFAULT_LOCALE}/search?q=audio`);
  });

  test('a first segment that is not a language tag is left untouched', async ({ request }) => {
    // `/robots.txt` is the sharp edge: a looser matcher would read `ro` as a
    // language tag and 301 the SEO surface onto /fr/bots.txt.
    const res = await request.get('/robots.txt', { maxRedirects: 0 });
    expect([200, 304]).toContain(res.status());
    expect(res.headers()['location']).toBeUndefined();
  });

  test('browser navigation to / lands on /<locale>/ with no SPA flash on /', async ({
    page,
    baseURL,
  }) => {
    // page.url() is 'about:blank' at test start — Playwright rejects that as a
    // cookie URL. Use the configured baseURL instead so the cookie domain
    // matches the storefront origin.
    await page
      .context()
      .addCookies([
        { name: 'storefront_locale', value: 'en', url: baseURL ?? 'http://localhost:53311/' },
      ]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/en\/$/);
  });
});
