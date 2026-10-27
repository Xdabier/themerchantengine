import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  attachConsoleBaseline,
  describeEveryLocale,
  waitForHydration,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S6 — catalog (category + product detail) journey.
 *
 * Boots against the real test API + fixture catalogue seed (no fixtures, no
 * page.route() per constitution §3.8). Exercises:
 *   - home → category navigation,
 *   - sort + filter URL state on the category page,
 *   - category → product detail navigation,
 *   - add-to-cart → header cart-badge increments,
 *   - JSON-LD payload set on each surface,
 *   - axe sweep at every viewport in both locales.
 */

describeEveryLocale('storefront S6 catalog journey', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`add-to-cart on a known in-stock product increments header badge at /${locale}/`, async ({
    page,
  }) => {
    // Per clarifications §1.23 + the /phase S6 BLOCKED-D resolution: this
    // test is gated to a production-build context (`STOREFRONT_E2E_BUILT=1`)
    // because the Vite dev-server SSR cold-start consistently exceeds even
    // a 300 s per-test budget under parallel-worker contention (3 workers ×
    // 2 locales × 3 viewport projects = 6 concurrent test instances all
    // racing the same SSR compilation). The cart-add wiring itself is
    // covered today by `product-summary.component.spec.ts` (button state
    // machine) + `cart.service.spec.ts` (HTTP + signal sync). The full
    // end-to-end gate runs on the production-build CI tier (gated by
    // STOREFRONT_E2E_BUILT) per clarifications §1.23 — dev-server
    // cold-start budget is too tight under parallel-worker contention.
    test.skip(
      !process.env['STOREFRONT_E2E_BUILT'],
      'add-to-cart e2e runs on the production-build CI tier per clarifications §1.23',
    );

    const productSlug = 'fx-laptop-pro-16-studio';
    await page.goto(`/${locale}/catalog/product/${productSlug}`);

    await expect(page.locator('[data-testid="product-summary"]')).toBeVisible({
      timeout: 15000,
    });
    const cta = page.locator('[data-testid="product-add-to-cart"]');
    await expect(cta).toBeEnabled({ timeout: 10000 });

    const initialCount = await page
      .locator('[data-testid="header-cart-badge"]')
      .first()
      .textContent()
      .catch(() => null);
    const initial = initialCount ? Number(initialCount.trim()) : 0;
    await cta.click();
    await expect(page.locator('[data-testid="header-cart-badge"]').first()).toHaveText(
      String(initial + 1),
      { timeout: 10000 },
    );
  });

  test(`home → category → product navigation chain renders at /${locale}/`, async ({ page }) => {
    // Navigation-only assertion — does not click Add-to-Cart so the test
    // budget is not consumed by the CTA round-trip after 3 SSR loads.
    await page.goto(`/${locale}/`);
    // A tile clicked before hydration is dropped and the URL never moves.
    await waitForHydration(page);
    const tiles = page.locator('[data-testid^="home-category-"]');
    await expect(tiles.first()).toBeVisible();
    const categoryHref = await tiles.first().getAttribute('href');
    expect(categoryHref).toMatch(new RegExp(`^/${locale}/catalog/[a-z0-9-]+$`));
    await Promise.all([
      page.waitForURL(categoryHref ?? new RegExp(`/${locale}/catalog/`)),
      tiles.first().click(),
    ]);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });

    const productLinks = page.locator('[data-testid="catalog-grid"] app-product-card a').first();
    await expect(productLinks).toBeVisible();
    const productHref = await productLinks.getAttribute('href');
    expect(productHref).toMatch(new RegExp(`^/${locale}/catalog/product/[a-z0-9-]+$`));
    await Promise.all([
      page.waitForURL(productHref ?? new RegExp(`/${locale}/catalog/product/`)),
      productLinks.click(),
    ]);
    await expect(page.locator('[data-testid="product-summary"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test(`category page emits BreadcrumbList + ItemList JSON-LD on /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    // A tile clicked before hydration is dropped and the URL never moves.
    await waitForHydration(page);
    const tiles = page.locator('[data-testid^="home-category-"]');
    const href = await tiles.first().getAttribute('href');
    await Promise.all([
      page.waitForURL(href ?? new RegExp(`/${locale}/catalog/`)),
      tiles.first().click(),
    ]);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });
    const scripts = page.locator('script[type="application/ld+json"][data-catalog-jsonld]');
    const count = await scripts.count();
    expect(count).toBeGreaterThanOrEqual(2);
    const types = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      const body = await scripts.nth(i).textContent();
      const parsed = JSON.parse(body ?? '{}');
      expect(parsed['@context']).toBe('https://schema.org');
      types.add(parsed['@type']);
    }
    expect(types.has('BreadcrumbList')).toBe(true);
    expect(types.has('ItemList')).toBe(true);
  });

  test(`product detail emits BreadcrumbList + Product JSON-LD on /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    // A tile clicked before hydration is dropped and the URL never moves.
    await waitForHydration(page);
    const tiles = page.locator('[data-testid^="home-category-"]');
    const categoryHref = await tiles.first().getAttribute('href');
    await Promise.all([
      page.waitForURL(categoryHref ?? new RegExp(`/${locale}/catalog/`)),
      tiles.first().click(),
    ]);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });
    const productLinks = page.locator('[data-testid="catalog-grid"] app-product-card a').first();
    const productHref = await productLinks.getAttribute('href');
    await Promise.all([
      page.waitForURL(productHref ?? new RegExp(`/${locale}/catalog/product/`)),
      productLinks.click(),
    ]);
    await expect(page.locator('[data-testid="product-summary"]')).toBeVisible({
      timeout: 15000,
    });
    const scripts = page.locator('script[type="application/ld+json"][data-product-jsonld]');
    const count = await scripts.count();
    expect(count).toBeGreaterThanOrEqual(2);
    const types = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      const body = await scripts.nth(i).textContent();
      const parsed = JSON.parse(body ?? '{}');
      expect(parsed['@context']).toBe('https://schema.org');
      types.add(parsed['@type']);
    }
    expect(types.has('BreadcrumbList')).toBe(true);
    expect(types.has('Product')).toBe(true);
  });

  test(`category sort change updates URL on /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    // A tile clicked before hydration is dropped and the URL never moves.
    await waitForHydration(page);
    const tiles = page.locator('[data-testid^="home-category-"]');
    const href = await tiles.first().getAttribute('href');
    await Promise.all([
      page.waitForURL(href ?? new RegExp(`/${locale}/catalog/`)),
      tiles.first().click(),
    ]);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });
    // Retry the interaction, not a longer wait. The grid is server-rendered,
    // so it is visible before the app is interactive, and a `change` fired
    // into that window reaches no listener. Each attempt drives the control
    // again, so this fails when the app never becomes interactive rather than
    // when a fixed budget runs out.
    const sort = page.locator('catalog-sort-control select');
    await expect(async () => {
      await sort.selectOption('priceAsc');
      expect(page.url()).toMatch(/sortBy=price/);
    }).toPass({ timeout: 30_000 });
    await page.waitForURL(/sortBy=price/);
    expect(page.url()).toMatch(/sortBy=price/);
    expect(page.url()).toMatch(/sortOrder=asc/);
  });

  test(`axe — zero serious / critical on catalog + product at /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    // A tile clicked before hydration is dropped and the URL never moves.
    await waitForHydration(page);
    const tiles = page.locator('[data-testid^="home-category-"]');
    const categoryHref = await tiles.first().getAttribute('href');
    await Promise.all([
      page.waitForURL(categoryHref ?? new RegExp(`/${locale}/catalog/`)),
      tiles.first().click(),
    ]);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });
    await injectAxe(page);
    await checkA11y(page, undefined, {
      detailedReport: false,
      axeOptions: {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
      },
    });

    const productLinks = page.locator('[data-testid="catalog-grid"] app-product-card a').first();
    const productHref = await productLinks.getAttribute('href');
    await Promise.all([
      page.waitForURL(productHref ?? new RegExp(`/${locale}/catalog/product/`)),
      productLinks.click(),
    ]);
    await expect(page.locator('[data-testid="product-summary"]')).toBeVisible({
      timeout: 15000,
    });
    await injectAxe(page);
    await checkA11y(page, undefined, {
      detailedReport: false,
      axeOptions: {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
      },
    });
  });
});

/**
 * Finding C7, behaviour half (plan K Phase K4).
 *
 * The sort select seeds itself to "Newest", but no query builder sent a sort
 * unless the URL carried one, so `/v1/products` fell back to `sortOrder asc`
 * over rows that all have sortOrder 0: an unspecified order under an honest
 * label. Read-only journey, so the console baseline is the binding mandate
 * here; it runs under both locales anyway because the grid is locale-rendered.
 */
describeEveryLocale('storefront C7 catalog default sort', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`a bare /${locale}/catalog is ordered newest-first`, async ({ page, request }) => {
    // Data-driven: ask the API for the order the label promises and compare
    // slugs, so the assertion survives a reseed and any catalogue change.
    const res = await request.get(
      `${STOREFRONT_API_BASE}/v1/products?page=1&pageSize=24&sortBy=createdAt&sortOrder=desc`,
    );
    expect(res.status()).toBe(200);
    const expected = (await res.json()).data as { slug: string }[];
    expect(expected.length).toBeGreaterThan(0);

    await page.goto(`/${locale}/catalog`);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });

    const firstHref = await page
      .locator('[data-testid="catalog-grid"] app-product-card a')
      .first()
      .getAttribute('href');
    expect(firstHref).toBe(`/${locale}/catalog/product/${expected[0].slug}`);
  });

  test(`the sort select still wins over the default on /${locale}/catalog`, async ({
    page,
    request,
  }) => {
    const res = await request.get(
      `${STOREFRONT_API_BASE}/v1/products?page=1&pageSize=24&sortBy=price&sortOrder=asc`,
    );
    expect(res.status()).toBe(200);
    const expected = (await res.json()).data as { slug: string }[];
    expect(expected.length).toBeGreaterThan(0);

    await page.goto(`/${locale}/catalog?sortBy=price&sortOrder=asc`);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });

    const firstHref = await page
      .locator('[data-testid="catalog-grid"] app-product-card a')
      .first()
      .getAttribute('href');
    expect(firstHref).toBe(`/${locale}/catalog/product/${expected[0].slug}`);
  });
});
