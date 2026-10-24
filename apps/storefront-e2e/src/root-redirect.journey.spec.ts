import { expect, test } from '@playwright/test';

import { activeStoreConfigFixture, attachConsoleBaseline, type ConsoleBaseline } from './support';

/** The locale the active fixture falls back to with no cookie/header match. */
const DEFAULT_LOCALE = activeStoreConfigFixture().localization.defaultLocale;

/**
 * Phase SH5 — Root path `/` SSR redirect journey.
 *
 * Asserts AC-6 (root redirect) from `specs/features/storefront-ssr-data-hydration/spec.md`:
 * `GET /` returns a 302 with `Location: /{locale}/` against both the Vite dev
 * pipeline (closes the dev gap where Nitro middleware doesn't fire — see
 * clarifications §1.14) and the production-build pipeline (covered by the
 * existing Nitro middleware at
 * `apps/storefront/src/server/middleware/locale-redirect.ts`, reinforced by
 * the new SSR `index.server.ts`).
 *
 * Locale precedence (mirrors `apps/storefront/src/server/middleware/locale-redirect.ts`):
 *   1. `storefront_locale` cookie  →  redirects to `/{cookie-value}/`
 *   2. `Accept-Language` header    →  redirects to the first supported locale by q-value
 *   3. the active fixture's `localization.defaultLocale` → its own fallback redirect
 *
 * Pure HTTP-layer test (`request.get`, no browser engine), runs on every
 * Playwright project including mobile-safari per clarifications §1.9.
 */

test.describe('storefront SH5 root redirect — raw HTTP', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`GET / with no cookie + no Accept-Language redirects to /${DEFAULT_LOCALE}/ (DEFAULT_LOCALE)`, async ({
    request,
  }) => {
    const res = await request.get('/', {
      maxRedirects: 0,
      headers: {
        // playwright defaults to en-US; explicitly clear to exercise the
        // DEFAULT_LOCALE fallback path.
        'accept-language': '',
      },
    });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] ?? '';
    expect(location, `expected /${DEFAULT_LOCALE}/ default redirect`).toBe(`/${DEFAULT_LOCALE}/`);
  });

  test('GET / with Accept-Language: en redirects to /en/', async ({ request }) => {
    const res = await request.get('/', {
      maxRedirects: 0,
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toBe('/en/');
  });

  test(`GET / with an Accept-Language of only retired/unsupported tags falls back to /${DEFAULT_LOCALE}/`, async ({
    request,
  }) => {
    // `ar` is the retired locale and `de` was never supported. Neither may
    // resolve, so the header contributes nothing and DEFAULT_LOCALE decides.
    const res = await request.get('/', {
      maxRedirects: 0,
      headers: { 'accept-language': 'ar-QA,ar;q=0.9,de;q=0.5' },
    });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toBe(`/${DEFAULT_LOCALE}/`);
  });

  test('GET / with storefront_locale=en cookie wins over Accept-Language: fr', async ({
    request,
  }) => {
    const res = await request.get('/', {
      maxRedirects: 0,
      headers: {
        cookie: 'storefront_locale=en',
        // A supported, conflicting header: without the cookie this resolves
        // to /fr/, so the assertion below isolates the cookie's precedence.
        'accept-language': 'fr-QA,fr;q=0.9',
      },
    });
    expect(res.status()).toBe(302);
    expect(
      res.headers()['location'],
      'cookie should win over Accept-Language per locale-redirect.ts precedence',
    ).toBe('/en/');
  });
});
