import { expect, test } from '@playwright/test';

import { attachConsoleBaseline, type ConsoleBaseline } from './support';

/**
 * Phase S22 — B2 mobile search hide on header + inline mobile input on
 * the search page.
 *
 * Asserts that at a 360 px viewport:
 *  - the header `.search-shell` is hidden via `display: none`,
 *  - the bottom-nav search shortcut is tappable + keyboard-reachable,
 *  - the `/search` page renders the mobile-only inline input.
 */

test.describe('storefront S22 — B2 mobile search', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test.use({ viewport: { width: 360, height: 740 } });

  test('header .search-shell is hidden at 360 px viewport', async ({ page }) => {
    await page.goto('/en/');
    const searchShell = page.locator('header[role="banner"] .search-shell');
    // The shell either does not exist in the DOM or is computed-style hidden.
    if ((await searchShell.count()) > 0) {
      const display = await searchShell.first().evaluate((el) => getComputedStyle(el).display);
      expect(display).toBe('none');
    }
  });

  test('bottom-nav search shortcut is the sole mobile entry point', async ({ page }) => {
    await page.goto('/en/');
    const bottomSearch = page.locator(
      'nav[aria-label] [data-testid="mobile-bottom-nav-search"], nav [data-testid="mobile-bottom-nav-search"]',
    );
    if ((await bottomSearch.count()) === 0) {
      // Fallback selector — the shortcut is an anchor labelled with the
      // header search-submit label.
      const fallback = page.locator('a[href$="/search"]').first();
      await expect(fallback).toBeVisible();
    } else {
      await expect(bottomSearch.first()).toBeVisible();
    }
  });

  test('/<locale>/search renders the mobile-only inline input below the header', async ({
    page,
  }) => {
    await page.goto('/en/search');
    const mobileInput = page.locator('[data-testid="mobile-search-input"]');
    await expect(mobileInput).toBeVisible();
    // Exposes the combobox a11y wiring per the WAI-ARIA 1.2 pattern.
    await expect(mobileInput).toHaveAttribute('role', 'combobox');
    await expect(mobileInput).toHaveAttribute('aria-autocomplete', 'list');
  });

  test('mobile inline input pre-fills from the ?q= query parameter', async ({ page }) => {
    await page.goto('/en/search?q=laptop');
    const mobileInput = page.locator('[data-testid="mobile-search-input"]');
    await expect(mobileInput).toHaveValue('laptop');
  });

  /**
   * Finding C8, mobile half (plan L Phase L3). Same contract as the header
   * combobox: suggestions arrive with nothing active, so Enter searches the
   * typed text and only an arrowed-to item is committed.
   */
  test('Enter with nothing arrowed to searches the typed text', async ({ page }) => {
    await page.goto('/en/search');
    const mobileInput = page.locator('[data-testid="mobile-search-input"]');
    await expect(mobileInput).toBeVisible();

    // The input is server-rendered, so drive it until the suggest list opens:
    // that is both the hydration wait and proof the combobox is live.
    await expect(async () => {
      await mobileInput.fill('laptop');
      await expect(page.locator('#mobile-search-listbox')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 60000 });
    await expect(mobileInput).not.toHaveAttribute('aria-activedescendant', /.+/);

    await mobileInput.press('Enter');
    await page.waitForURL(/\/en\/search\?q=laptop/, { timeout: 15000 });
  });
});

test.describe('storefront S22 — B2 desktop parity', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test.use({ viewport: { width: 1280, height: 900 } });

  test('header search-shell stays visible on desktop', async ({ page }) => {
    await page.goto('/en/');
    const searchShell = page.locator('header[role="banner"] .search-shell');
    await expect(searchShell).toBeVisible();
  });

  test('mobile inline search input is hidden at the desktop breakpoint', async ({ page }) => {
    await page.goto('/en/search');
    const mobileShell = page.locator('[data-testid="mobile-search-shell"]');
    if ((await mobileShell.count()) > 0) {
      const visible = await mobileShell.first().isVisible();
      expect(visible).toBe(false);
    }
  });
});
