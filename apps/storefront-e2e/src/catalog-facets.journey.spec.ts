import { expect, test, type Page, type Request } from '@playwright/test';

import {
  attachConsoleBaseline,
  describeEveryLocale,
  reloadAndAssertClean,
  STOREFRONT_API_BASE,
  type ConsoleBaseline,
  activeStoreConfigFixture,
} from './support';

/**
 * Plan L Phase L1 - findings C1, C7 and C2.
 *
 * Every query-param control on the catalogue used to update the URL and leave
 * the grid on the previous payload, because the page refetched from the
 * pre-navigation route snapshot and overwrote itself with the old filters. The
 * route re-resolves its loader on a query-param change, so the payload that
 * lands is already filtered and no browser fetch is needed at all.
 *
 * The assertions are therefore: the grid matches what the API returns for the
 * new URL, no `/v1/products` request fires from the gesture, and the document
 * title stays the catalogue title instead of flipping to the home title.
 *
 * Real seeded test API (constitution 3.8 - no fixtures, no `page.route()`).
 * Every count is read from that API rather than hardcoded, so the spec holds
 * across reseeds.
 */

const PAGE_SIZE = 24;

/**
 * Mirrors `PRICE_BANDS` in `sections/catalog/filter-rail.component.ts`.
 *
 * The upper bound is one display step below the next band's floor, and the step
 * is the store's configured precision. These used to read `49.999`, which is
 * one step below fifty only in a three-decimal currency: against a two-decimal
 * store the component computes `49.99` and this mirror disagreed with it over
 * the range in between. Derived here for the same reason the component derives
 * it (plan E2.6).
 */
const PRICE_BAND_STEP = 10 ** -activeStoreConfigFixture().money.displayPrecision;
const PRICE_BANDS: Record<string, { min: number | null; max: number | null }> = {
  under50: { min: null, max: 50 - PRICE_BAND_STEP },
  '50to250': { min: 50, max: 250 - PRICE_BAND_STEP },
  '250to1000': { min: 250, max: 1000 - PRICE_BAND_STEP },
  over1000: { min: 1000, max: null },
};

interface ApiPage {
  slugs: string[];
  total: number;
}

async function apiProducts(page: Page, query: Record<string, string | number>): Promise<ApiPage> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(PAGE_SIZE),
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  });
  const res = await page.request.get(`${STOREFRONT_API_BASE}/v1/products?${params.toString()}`);
  expect(res.ok(), `GET /v1/products?${params.toString()} answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as {
    data: { slug: string }[];
    meta?: { total?: number };
  };
  return { slugs: body.data.map((p) => p.slug), total: body.meta?.total ?? body.data.length };
}

async function gridSlugs(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="catalog-grid"] li[data-product-slug]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-product-slug') ?? ''));
}

/** Collects every browser fetch of the products list endpoint. */
function collectProductRequests(page: Page): { urls: string[]; reset: () => void } {
  const urls: string[] = [];
  page.on('request', (req: Request) => {
    const url = req.url();
    if (url.includes('/v1/products?') || url.endsWith('/v1/products')) urls.push(url);
  });
  return { urls, reset: () => urls.splice(0, urls.length) };
}

describeEveryLocale('catalogue facet navigation', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  /**
   * The grid is server-rendered, so it is visible before the app is
   * interactive and a gesture fired into that window reaches no listener.
   * Driving the sort control until the URL moves is both the hydration probe
   * and the first half of the assertion: after it passes, the page is live and
   * the URL carries a sort the loader has already answered.
   */
  async function sortAndAwaitHydration(page: Page): Promise<void> {
    const sort = page.locator('catalog-sort-control select');
    await expect(async () => {
      await sort.selectOption('priceAsc');
      expect(page.url()).toMatch(/sortBy=price/);
    }).toPass({ timeout: 60000 });
    await page.waitForURL(/[?&]sortOrder=asc/, { timeout: 30000 });
  }

  test(`a sort change reorders the grid through the loader (${locale})`, async ({ page }) => {
    const products = collectProductRequests(page);

    await page.goto(`/${locale}/catalog`);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 30000,
    });
    const ascending = await apiProducts(page, { sortBy: 'price', sortOrder: 'asc' });

    await sortAndAwaitHydration(page);
    await expect
      .poll(async () => (await gridSlugs(page)).join(','), { timeout: 30000 })
      .toBe(ascending.slugs.join(','));
    expect(await page.title()).toContain('Catalogue');
    // No products request of the page's own is left in the list beyond the
    // ones this spec issued through the API context, which do not go through
    // the browser. Before the fix the gesture fired one carrying the
    // pre-navigation params, and its response overwrote the grid.
    expect(products.urls, `stray products requests: ${products.urls.join(' | ')}`).toEqual([]);
  });

  /**
   * Plan L Phase L5 - finding C11, absorbing the prior pass's C5.
   *
   * The rail used to compute its brand list from the products on screen, which
   * is a page-1 sample of the already-filtered result, so choosing a brand left
   * exactly that brand in the list and the shopper could not switch without
   * clearing. The list comes from the catalogue now, so it does not move.
   */
  test(`the brand facet keeps every brand after one is selected (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/catalog`);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 30000,
    });

    const res = await page.request.get(`${STOREFRONT_API_BASE}/v1/products/brands`);
    expect(res.ok(), `GET /v1/products/brands answered ${res.status()}`).toBe(true);
    const expected = ((await res.json()) as { data: { brand: string }[] }).data.map((f) => f.brand);
    expect(expected.length, 'the seeded catalogue carries no brands').toBeGreaterThan(0);

    const radios = page.locator('catalog-filter-rail input[name="brand"]');
    await expect
      .poll(
        async () => radios.evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).value)),
        {
          timeout: 30000,
        },
      )
      .toEqual(expected);

    await sortAndAwaitHydration(page);
    const chosen = await radios.first().inputValue();
    await radios.first().check();
    await page.locator('catalog-filter-rail .actions .apply').click();
    await page.waitForURL(/[?&]brand=/, { timeout: 30000 });

    // The grid narrowed. This assertion is the point of the test and it used to
    // be missing: the url and the rail are both written client-side and are
    // true whether or not the filter ever reached the server, so a catalogue
    // that came back unfiltered read as a pass. Deep-link coverage of the same
    // claim, with no browser at all, lives in `catalog-query-ssr.journey.spec.ts`.
    const sorted = { sortBy: 'price', sortOrder: 'asc' };
    const unfiltered = await apiProducts(page, sorted);
    const narrowed = await apiProducts(page, { ...sorted, brand: chosen });
    expect(narrowed.total, `brand ${chosen} matched nothing`).toBeGreaterThan(0);
    expect(narrowed.slugs, `brand ${chosen} does not narrow the catalogue`).not.toEqual(
      unfiltered.slugs,
    );
    await expect
      .poll(async () => (await gridSlugs(page)).join(','), { timeout: 30000 })
      .toBe(narrowed.slugs.join(','));

    // The rail did not.
    await expect
      .poll(
        async () => radios.evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).value)),
        {
          timeout: 30000,
        },
      )
      .toEqual(expected);
  });

  test(`a price band refilters the grid through the loader (${locale})`, async ({ page }) => {
    const products = collectProductRequests(page);

    await page.goto(`/${locale}/catalog`);
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 30000,
    });
    await sortAndAwaitHydration(page);

    const sorted: Record<string, string> = { sortBy: 'price', sortOrder: 'asc' };
    const unfiltered = await apiProducts(page, sorted);

    // Pick a band that actually narrows this catalogue, reading the counts from
    // the API so a reseed cannot silently turn the test into a no-op.
    const radios = page.locator('catalog-filter-rail input[name="price-band"]');
    const bandCount = await radios.count();
    expect(bandCount).toBeGreaterThan(0);
    let chosenIndex = -1;
    let expected: ApiPage | null = null;
    for (let i = 0; i < bandCount; i += 1) {
      const value = await radios.nth(i).inputValue();
      const band = PRICE_BANDS[value];
      if (!band) continue;
      const query: Record<string, string | number> = { ...sorted };
      if (band.min !== null) query['minPrice'] = band.min;
      if (band.max !== null) query['maxPrice'] = band.max;
      const result = await apiProducts(page, query);
      if (result.total > 0 && result.total < unfiltered.total) {
        chosenIndex = i;
        expected = result;
        break;
      }
    }
    expect(expected, 'no price band narrows the seeded catalogue').not.toBeNull();

    products.reset();
    await radios.nth(chosenIndex).check();
    await page.locator('catalog-filter-rail .actions .apply').click();
    await page.waitForURL(/[?&](minPrice|maxPrice)=/, { timeout: 30000 });

    const expectedSlugs = expected!.slugs;
    await expect
      .poll(async () => (await gridSlugs(page)).join(','), { timeout: 30000 })
      .toBe(expectedSlugs.join(','));
    await expect(page.locator('.results')).toContainText(String(expected!.total));
    expect(products.urls, `stray products requests: ${products.urls.join(' | ')}`).toEqual([]);

    // Finding C2: the title strategy writes the home title on every navigation
    // and the page used to let it win once the component was reused.
    const catalogTitle = await page.title();
    expect(catalogTitle).toContain('Catalogue');

    await reloadAndAssertClean(page, page.url(), baseline, {
      afterReload: async () => {
        await expect
          .poll(async () => (await gridSlugs(page)).join(','), { timeout: 30000 })
          .toBe(expectedSlugs.join(','));
        expect(await page.title()).toBe(catalogTitle);
      },
    });
  });
});
