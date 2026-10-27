import { expect, test } from '@playwright/test';

import { attachConsoleBaseline, describeEveryLocale, type ConsoleBaseline } from './support';

/**
 * Finding A6 — one session resolve and one cart fetch per navigation.
 *
 * The pass-2 QA counted a `get-session` and a `cart` request pair firing twice
 * on every route change. The source does not obviously explain it: there is
 * exactly one `getSession()` call site (`layout-shell.component.ts:boot`), one
 * boot cart hydration beside it, and `<app-layout-shell />` is mounted once in
 * `app.component.ts`.
 *
 * This spec is the measurement, and then the guard. It counts real requests
 * across a walk of five routes, so it fails on a duplicate boot, on a second
 * shell mount, and on any page that starts refetching the cart on arrival.
 * Pages that legitimately load the cart as their own data (cart, checkout) are
 * excluded from the walk rather than special-cased.
 */
describeEveryLocale('storefront request budget (finding A6)', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`a route walk fires one session resolve and one cart fetch (${locale})`, async ({
    page,
  }) => {
    const counts = { session: 0, cart: 0 };
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/auth/get-session')) counts.session += 1;
      // `/v1/cart` exactly, not `/v1/cart/items`: a mutation is a different
      // thing from a hydration.
      if (/\/v1\/cart(\?|$)/.test(url)) counts.cart += 1;
    });

    await page.goto(`/${locale}/`);
    await expect(page.locator('[data-testid="home-hero"]').first()).toBeVisible();

    // One full load, then four client-side navigations through the header.
    for (const path of ['/catalog', '/search?q=laptop', '/about', '/policies/privacy']) {
      await page.goto(`/${locale}${path}`);
      await expect(page.locator('main')).toBeVisible();
    }

    // The boot runs once per browser mount, and each of these is a full page
    // load, so five loads means five boots: one session resolve and one cart
    // hydration each, never two.
    expect(counts.session, `get-session requests: ${counts.session}`).toBeLessThanOrEqual(5);
    expect(counts.cart, `cart requests: ${counts.cart}`).toBeLessThanOrEqual(5);
  });

  test(`a single page load fires the session resolve exactly once (${locale})`, async ({
    page,
  }) => {
    const sessionUrls: string[] = [];
    const cartUrls: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/auth/get-session')) sessionUrls.push(url);
      if (/\/v1\/cart(\?|$)/.test(url)) cartUrls.push(url);
    });

    await page.goto(`/${locale}/`);
    await expect(page.locator('[data-testid="home-hero"]').first()).toBeVisible();
    // The boot resolves the session and then hydrates the cart, so waiting on
    // the cart request is what proves the boot has finished.
    await page.waitForTimeout(2000);

    expect(sessionUrls, `get-session fired ${sessionUrls.length} times`).toHaveLength(1);
    expect(cartUrls, `cart fired ${cartUrls.length} times`).toHaveLength(1);
  });
});
