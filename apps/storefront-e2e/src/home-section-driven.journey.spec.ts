import { expect, test } from '@playwright/test';

import {
  STOREFRONT_LOCALES,
  attachConsoleBaseline,
  waitForHydration,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S5 — home page journey, section-driven assertions.
 *
 * These tests assert on testids that only appear after the page's
 * client-side Angular hydration fetches `GET /v1/storefront/sections/home`
 * and populates the `sections` signal (S21 dynamic-dispatch path,
 * `apps/storefront/src/app/pages/[locale]/index.page.ts:317-320`).
 *
 * The mobile-safari Playwright project excludes this file via `testIgnore`
 * in `apps/storefront-e2e/playwright.config.ts` because WebKit + Vite SSR
 * dev-server cold-start does not fire the hydration fetch reliably under
 * Playwright control — the section-driven testids never resolve, even at
 * a 60 s ceiling. Recorded in clarifications §1.35; matches the build-gate
 * deferral lineage of §1.23 (S6 cart-add) and §1.27 (S9 auth journey).
 *
 * The always-rendered + JSON-LD + hreflang + axe assertions live in
 * `home.journey.spec.ts` and continue to run on every project including
 * mobile-safari, so SSR-rendered surface coverage does not regress.
 */

// `home-mid-banner` left this list at D6. PROMOTIONAL_BANNER is still a valid
// SectionType on the API and in the admin, but brand-floor §5.3 gives this
// client no lifestyle imagery tier, so the storefront surface was removed
// rather than rebuilt and the dispatch path filters the type out.
//
// `home-just-arrived` and `home-popular` left it at B3: they were hardcoded
// rails appended per CATEGORY_SHOWCASE / TRUST_SIGNALS row, not sections. The
// curated FEATURED_PRODUCTS rail is asserted separately below, by prefix,
// because its testid carries the section id.
const SECTION_DRIVEN_TESTIDS = ['home-hero', 'home-categories', 'home-trust-strip'];

/**
 * Per-locator ceiling absorbing client-side hydration + API round-trip.
 * Chromium projects exit on first paint in <5 s; the 60 s budget is for
 * cold-start variance under Vite + Analog SSR. Lowered when the v2 SSG/ISR
 * build replaces the dev-server cold path (clarifications §1.23).
 */
const SECTION_TIMEOUT_MS = 60_000;

test.describe('storefront S5 home page (section-driven)', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test('renders all section-driven home blocks in every served locale', async ({ page }) => {
    for (const locale of STOREFRONT_LOCALES) {
      await page.goto(`/${locale}/`);
      // `.first()` absorbs the case where the seed left more than one section
      // of the same type in the DB across re-runs (soft-delete leftovers from
      // prior seed cycles); the contract is "at least one renders" not "exactly one".
      for (const id of SECTION_DRIVEN_TESTIDS) {
        await expect(page.locator(`[data-testid="${id}"]`).first()).toBeVisible({
          timeout: SECTION_TIMEOUT_MS,
        });
      }
    }
  });

  test('hero CTA links to the locale-prefixed catalog route', async ({ page }) => {
    await page.goto('/fr/');
    const cta = page.locator('[data-testid="home-hero-cta"]').first();
    await expect(cta).toBeVisible({ timeout: SECTION_TIMEOUT_MS });
    await expect(cta).toHaveAttribute('href', /\/fr\/catalog$/);
  });

  test('categories grid renders ≥1 category and each tile points at /<locale>/catalog/<slug>', async ({
    page,
  }) => {
    await page.goto('/en/');
    const tiles = page.locator('[data-testid^="home-category-"]');
    await expect(tiles.first()).toBeVisible({ timeout: SECTION_TIMEOUT_MS });
    const count = await tiles.count();
    expect(count).toBeGreaterThanOrEqual(1);
    const firstHref = await tiles.first().getAttribute('href');
    expect(firstHref).toMatch(/^\/en\/catalog\/[a-z0-9-]+$/);
  });

  test('clicking the first category navigates to its catalog URL and the grid renders', async ({
    page,
  }) => {
    await page.goto('/fr/');
    // A tile clicked before hydration is dropped and the URL never moves.
    await waitForHydration(page);
    const tiles = page.locator('[data-testid^="home-category-"]');
    await expect(tiles.first()).toBeVisible({ timeout: SECTION_TIMEOUT_MS });
    const href = await tiles.first().getAttribute('href');
    expect(href).toMatch(/^\/fr\/catalog\/[a-z0-9-]+$/);
    await Promise.all([page.waitForURL(href ?? /\/fr\/catalog\//), tiles.first().click()]);
    expect(page.url()).toContain(href ?? '/fr/catalog/');
    // S6 catalog page is real — assert the product grid renders.
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('at least one curated featured rail renders from the section config', async ({ page }) => {
    // Replaces the deleted entry-tier price-band test. FEATURED_PRODUCTS rails
    // are the only product rails the home page has left, and their testid is
    // suffixed with the section id, so match by prefix.
    await page.goto('/en/');
    await expect(page.locator('[data-testid^="home-featured-"]').first()).toBeVisible({
      timeout: SECTION_TIMEOUT_MS,
    });
  });

  test('trust strip exposes 4 pillar tiles', async ({ page }) => {
    await page.goto('/en/');
    // Trust strip renders after hydration + TRUST_SIGNALS section API fetch.
    // The section must carry items with kind: delivery | returns | authentic | support
    // (seeded via prisma/seeds/fixture-catalogue/storefront-sections.ts).
    // `.first()` defends against same-kind tiles from a soft-deleted prior
    // seed surfacing alongside the active fixture catalogue trust strip.
    for (const kind of ['delivery', 'returns', 'authentic', 'support']) {
      await expect(page.locator(`[data-testid="home-trust-${kind}"]`).first()).toBeVisible({
        timeout: SECTION_TIMEOUT_MS,
      });
    }
  });
});
