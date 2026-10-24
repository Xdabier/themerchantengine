import { expect, test } from '@playwright/test';

import {
  attachConsoleBaseline,
  STOREFRONT_API_BASE,
  waitForHydration,
  type ConsoleBaseline,
} from './support';

/**
 * Phase IS1 — catalog infinite-scroll journey.
 *
 * Real seeded test API (constitution §3.8 — no fixtures, no `page.route()`).
 *
 * The browse-all total is read from the API rather than assumed: the earlier
 * client catalogue planted ~550 products, so hardcoding 3 full pages of 24
 * (72 cards) held by coincidence. The brandless fixture catalogue plants 36
 * plus the 10-product baseline demo seed, 46 total, which structurally cannot
 * fill a third page — so every assertion below derives the page count and the
 * last page's card count from `meta.total` instead of a literal.
 */

const PAGE_SIZE = 24;

async function gridCardCount(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('[data-testid="catalog-grid"] li[data-product-slug]').count();
}

/** `meta.total` for the unfiltered browse-all catalogue, read from the real API. */
async function browseAllTotal(page: import('@playwright/test').Page): Promise<number> {
  const res = await page.request.get(`${STOREFRONT_API_BASE}/v1/products?page=1&pageSize=1`);
  expect(res.ok(), `GET /v1/products answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { meta?: { total?: number } };
  const total = body.meta?.total;
  expect(typeof total, 'GET /v1/products must expose meta.total').toBe('number');
  return total as number;
}

/**
 * Loads `pageNum` and waits for its URL. Scrolling the sentinel into view lets
 * the `IntersectionObserver` fire; the component's own `<button>` is the
 * fallback for when it does not.
 *
 * The scroll alone often starts the load, which disables the button and, on
 * the last page, removes it. An unbounded click on it then waits for an
 * element that never comes back, so the click is short and the loop re-checks
 * the URL before every attempt.
 */
async function loadPage(page: import('@playwright/test').Page, pageNum: number): Promise<void> {
  const sentinel = page.locator('[data-testid="catalog-load-more-sentinel"]');
  const button = page.locator('[data-testid="catalog-load-more-button"]');
  const target = new RegExp(`[?&]page=${pageNum}`);
  await expect(async () => {
    if (target.test(page.url())) return;
    await sentinel.scrollIntoViewIfNeeded();
    if ((await button.isVisible()) && (await button.isEnabled()) && !target.test(page.url())) {
      await button.click({ timeout: 2000 });
    }
    expect(page.url()).toMatch(target);
  }).toPass({ timeout: 15000 });
}

async function clickLoadMoreIfPresent(page: import('@playwright/test').Page): Promise<boolean> {
  const button = page.locator('[data-testid="catalog-load-more-button"]');
  if ((await button.count()) === 0) return false;
  if (await button.isHidden()) return false;
  await button.click();
  return true;
}

test.describe('storefront IS1 catalog infinite scroll', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test('browse-all appends every page and updates URL ?page', async ({ page }) => {
    const total = await browseAllTotal(page);
    const lastPage = Math.ceil(total / PAGE_SIZE);
    // A catalogue that shrank to one page would make every assertion below
    // vacuously true (no scroll ever fires), which is the failure mode the
    // hardcoded "72 cards" version of this test could not catch either. Name
    // it rather than let the loop below silently no-op.
    expect(
      lastPage,
      `browse-all total is ${total}; need >1 page to exercise append`,
    ).toBeGreaterThan(1);

    await page.goto('/en/catalog');
    // The observer and the button only respond once the app has hydrated.
    await waitForHydration(page);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => gridCardCount(page), { timeout: 15000 }).toBe(PAGE_SIZE);

    for (let pageNum = 2; pageNum <= lastPage; pageNum += 1) {
      await loadPage(page, pageNum);
      const expectedCount = Math.min(PAGE_SIZE * pageNum, total);
      await expect.poll(() => gridCardCount(page), { timeout: 15000 }).toBe(expectedCount);
    }
  });

  /**
   * Plan L Phase L1. The previous version of this test looked for a
   * `select[name="brand"]` the rail has never rendered (it renders radios), so
   * both of its branches ended in `test.skip` and the only filter journey in
   * the suite had never executed once. Rewritten around the price band, which
   * every catalogue renders, so it cannot silently opt out again.
   */
  test('browse-all filter change resets URL ?page to 1 and shrinks grid', async ({ page }) => {
    const total = await browseAllTotal(page);
    const expectedBeforeCount = Math.min(PAGE_SIZE * 2, total);

    await page.goto('/en/catalog');
    // The observer and the button only respond once the app has hydrated.
    await waitForHydration(page);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });
    await loadPage(page, 2);
    await expect.poll(() => gridCardCount(page), { timeout: 15000 }).toBe(expectedBeforeCount);
    const beforeCount = await gridCardCount(page);

    const bands = page.locator('catalog-filter-rail input[name="price-band"]');
    await expect(bands.first()).toBeVisible({ timeout: 15000 });
    const apply = page.locator('catalog-filter-rail .actions .apply');
    const bandCount = await bands.count();

    // The rail is server-rendered, so it is visible before the app is
    // interactive and a gesture fired into that window reaches no listener.
    // Driving the first band until the URL moves is the hydration wait; every
    // later band is a fresh radio, so one change event is enough.
    await expect(async () => {
      await bands.first().check();
      await apply.click();
      expect(page.url()).toMatch(/[?&](minPrice|maxPrice)=/);
    }).toPass({ timeout: 60000 });
    expect(page.url()).toMatch(/[?&]page=1/);

    // Then walk the bands until one actually narrows this catalogue. Read from
    // the grid rather than assumed, so a reseed cannot turn this into a no-op.
    //
    // `waitForURL` on a static minPrice|maxPrice regex resolves the instant the
    // CURRENT url matches, which every band's url already does once the first
    // one has landed — it proves nothing about whether THIS band's navigation
    // finished, so a read taken right after it can catch the previous band's
    // grid. Polling the grid itself against its own pre-click count is what
    // actually waits for this band's render.
    let applied = (await gridCardCount(page)) > 0 && (await gridCardCount(page)) < beforeCount;
    for (let i = 1; i < bandCount && !applied; i += 1) {
      const beforeClick = await gridCardCount(page);
      await bands.nth(i).check();
      await apply.click();
      await expect.poll(() => gridCardCount(page), { timeout: 15000 }).not.toBe(beforeClick);
      expect(page.url()).toMatch(/[?&]page=1/);
      const after = await gridCardCount(page);
      applied = after > 0 && after < beforeCount;
    }
    expect(applied, 'no price band narrows the seeded catalogue').toBe(true);
  });

  test('browse-all back-nav restores the last page with every accumulated card', async ({
    page,
  }) => {
    const total = await browseAllTotal(page);
    const lastPage = Math.ceil(total / PAGE_SIZE);
    expect(lastPage, `browse-all total is ${total}; need >1 page for this test`).toBeGreaterThan(1);
    const lastPageCount = Math.min(PAGE_SIZE * lastPage, total);

    await page.goto(`/en/catalog?page=${lastPage}`);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 20000,
    });
    await expect.poll(() => gridCardCount(page), { timeout: 30000 }).toBe(lastPageCount);

    const firstCard = page.locator('[data-testid="catalog-grid"] li[data-product-slug] a').first();
    const cardHref = await firstCard.getAttribute('href');
    expect(cardHref).toMatch(/^\/en\/catalog\/product\//);
    await Promise.all([page.waitForURL(/\/catalog\/product\//), firstCard.click()]);
    await expect(page.locator('[data-testid="product-summary"]').first()).toBeVisible({
      timeout: 15000,
    });

    await page.goBack();
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 20000,
    });
    expect(page.url()).toMatch(new RegExp(`[?&]page=${lastPage}`));
    await expect.poll(() => gridCardCount(page), { timeout: 30000 }).toBe(lastPageCount);
  });

  test('per-category JSON-LD ItemList stays at PAGE_SIZE entries after appends', async ({
    page,
  }) => {
    await page.goto('/en/');
    // A tile clicked before hydration is dropped and the URL never moves.
    await waitForHydration(page);
    const tiles = page.locator('[data-testid^="home-category-"]');
    await expect(tiles.first()).toBeVisible({ timeout: 15000 });
    const href = await tiles.first().getAttribute('href');
    await Promise.all([page.waitForURL(href ?? /\/en\/catalog\//), tiles.first().click()]);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 15000,
    });

    const initial = await gridCardCount(page);
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThanOrEqual(PAGE_SIZE);

    const appended = await clickLoadMoreIfPresent(page);
    if (appended) {
      await page.waitForURL(/[?&]page=2/, { timeout: 15000 });
      await expect.poll(() => gridCardCount(page), { timeout: 15000 }).toBeGreaterThan(initial);
    }

    const itemListCount = await page.evaluate(() => {
      const scripts = Array.from(
        document.head.querySelectorAll<HTMLScriptElement>(
          'script[type="application/ld+json"][data-catalog-jsonld]',
        ),
      );
      const itemLists = scripts
        .map((s) => {
          try {
            return JSON.parse(s.textContent ?? '{}') as {
              '@type'?: string;
              itemListElement?: unknown[];
            };
          } catch {
            return null;
          }
        })
        .filter((p): p is { '@type'?: string; itemListElement?: unknown[] } => p !== null)
        .filter((p) => p['@type'] === 'ItemList');
      const last = itemLists[itemLists.length - 1];
      return Array.isArray(last?.itemListElement) ? last!.itemListElement.length : 0;
    });

    expect(itemListCount).toBeLessThanOrEqual(PAGE_SIZE);
    expect(itemListCount).toBeGreaterThan(0);
  });
});
