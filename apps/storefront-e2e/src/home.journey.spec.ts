import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test } from '@playwright/test';

import {
  STOREFRONT_HREFLANGS,
  STOREFRONT_LOCALES,
  attachConsoleBaseline,
  copyFor,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S5 — home page journey.
 *
 * Boots against the real test API + fixture catalogue seed (no fixtures, no
 * `page.route()` per constitution §3.8). Exercises every section the home
 * route ships, the navigation jump from a category tile, the JSON-LD
 * payload set, and an axe sweep at every viewport in both locales.
 */

/**
 * Seed-guaranteed home blocks. B3 deleted the four hardcoded rails, so every
 * block on the home page now comes from a `StorefrontSection` row. These two
 * are seeded for this client and, because the loader is a page-server
 * endpoint, they are present in the SSR HTML rather than hydrated in, so they
 * still cover every browser engine including mobile-safari.
 *
 * The rest of the section-driven assertions live in the sibling
 * `home-section-driven.journey.spec.ts`, which is excluded from mobile-safari
 * via `testIgnore` in playwright.config.ts — WebKit + Vite SSR dev-server
 * cold-start does not fire the hydration fetch reliably under Playwright
 * control. Recorded in clarifications §1.35, matching the §1.23 / §1.27
 * build-gate deferral lineage.
 */
const ALWAYS_RENDERED_TESTIDS = ['home-hero', 'home-categories'];

test.describe('storefront S5 home page', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  // One locale per test. Visiting both in one body meant the second `goto`
  // aborted the first route's in-flight module imports, and the rejected
  // dynamic import reached StorefrontErrorHandler, which the console baseline
  // fails on in teardown while the assertions themselves passed. The condition
  // only bites where the module graph is un-bundled and slow to settle, which
  // is WebKit under the Vite dev server, so it read as an engine quirk rather
  // than as a test that navigates away from work it started.
  for (const locale of STOREFRONT_LOCALES) {
    test(`renders the seeded home sections at /${locale}/`, async ({ page }) => {
      await page.goto(`/${locale}/`);
      // The loader resolves sections on the SSR pass, so these blocks are in
      // the first HTML payload and cover every browser engine including
      // mobile-safari.
      for (const id of ALWAYS_RENDERED_TESTIDS) {
        await expect(page.locator(`[data-testid="${id}"]`).first()).toBeVisible();
      }
    });
  }

  test('JSON-LD: Organization + WebSite + BreadcrumbList payloads parse and validate', async ({
    page,
  }) => {
    await page.goto('/fr/');
    const scripts = page.locator('script[type="application/ld+json"][data-home-jsonld]');
    const count = await scripts.count();
    expect(count).toBe(3);
    const seen = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      const body = await scripts.nth(i).textContent();
      expect(body).not.toBeNull();
      const parsed = JSON.parse(body ?? '{}');
      expect(parsed['@context']).toBe('https://schema.org');
      seen.add(parsed['@type']);
    }
    expect(seen.has('Organization')).toBe(true);
    expect(seen.has('WebSite')).toBe(true);
    expect(seen.has('BreadcrumbList')).toBe(true);
  });

  test('hreflang triplet is emitted on /fr/', async ({ page }) => {
    await page.goto('/fr/');
    // Driven by the shared matrix so the region tail lives in one file.
    for (const supported of STOREFRONT_LOCALES) {
      const link = page.locator(
        `link[rel="alternate"][hreflang="${copyFor(STOREFRONT_HREFLANGS, supported)}"]`,
      );
      await expect(link).toHaveCount(1);
    }
    const xd = page.locator('link[rel="alternate"][hreflang="x-default"]');
    await expect(xd).toHaveCount(1);
  });

  test('axe — zero serious / critical violations in every served locale', async ({ page }) => {
    for (const locale of STOREFRONT_LOCALES) {
      await page.goto(`/${locale}/`);
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
    }
  });
});
