import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  waitForHydration,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S7 — Search journey.
 *
 * Boots against the real test API + fixture catalogue seed (no fixtures, no
 * page.route() per constitution §3.8). Exercises the complete search
 * flow:
 *   - header combobox: type → debounce → suggest dropdown opens with
 *     listbox semantics → keyboard nav → land on /[locale]/search,
 *   - results page renders the title, count, sort, filter rail, grid,
 *   - sort URL synchronization,
 *   - click-event POST fires when a result card is clicked,
 *   - empty path renders the no-results state,
 *   - Esc + outside-click dismiss the dropdown,
 *   - axe sweep at every viewport in both locales.
 *
 * The seeded fixture catalogue (`prisma/seeds/fixture-catalogue/products.ts`)
 * carries multiple products with "laptop" / "headphones" in their
 * names, so `?q=laptop` reliably returns results in both locales.
 */

const HEADER_INPUT = '[data-testid="header-search-input"]';
const SUGGEST_LISTBOX = '#header-search-listbox';
const SUGGEST_OPTION = '[data-testid="suggest-option"]';
const SUGGEST_VIEW_ALL = '[data-testid="suggest-view-all"]';
const SEARCH_TITLE = '[data-testid="search-title"]';
const SEARCH_COUNT = '[data-testid="search-results-count"]';
const CARD = '[data-testid="catalog-grid"] app-product-card';
const CARD_PRICE = `${CARD} app-price .amount`;

/**
 * The digits of a rendered price, as a number.
 *
 * Digits only, deliberately. `lib/money.ts` groups with U+202F, spaces the symbol
 * with U+00A0 and switches the decimal mark between fr and en, and
 * `store-config.journey.spec.ts` can flip the store currency mid-run, so any
 * assertion touching separators or the symbol would be flaky for reasons that
 * have nothing to do with this guard. The exact formatting has a better owner in
 * `apps/storefront/src/lib/money.spec.ts`.
 */
function renderedAmount(text: string): number {
  return Number(text.replace(/\D/g, ''));
}

/**
 * Focus the header search input. Returns `false` when the input is not
 * visible at the current viewport (e.g. mobile, where the header
 * `.search-shell` is hidden after the S22 B2 responsive fix and the
 * bottom-nav shortcut is the sole mobile entry point). Callers must check
 * the return value and skip the test body if `false` — this avoids hard
 * failures on mobile projects where the combobox is deliberately absent.
 */
async function focusHeaderSearch(page: Page): Promise<boolean> {
  const input = page.locator(HEADER_INPUT).first();
  const visible = await input.isVisible().catch(() => false);
  if (!visible) return false;
  await input.focus();
  return true;
}

async function typeQuery(page: Page, value: string): Promise<void> {
  const input = page.locator(HEADER_INPUT).first();
  await input.fill('');
  await input.type(value, { delay: 30 });
}

describeEveryLocale('storefront S7 search journey', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`combobox a11y: input carries role="combobox" + aria-controls at /${locale}/`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/`);
    // Header search is hidden at mobile viewports (S22 B2). Skip the
    // combobox assertions on narrow viewports — the mobile entry point
    // is covered by mobile-search.journey.spec.ts.
    if (!(await focusHeaderSearch(page))) return;
    const input = page.locator(HEADER_INPUT).first();
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-controls', 'header-search-listbox');
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  test(`suggest dropdown opens on typing and exposes listbox semantics at /${locale}/`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/`);
    if (!(await focusHeaderSearch(page))) return;
    await typeQuery(page, 'laptop');

    const listbox = page.locator(SUGGEST_LISTBOX);
    await expect(listbox).toBeVisible({ timeout: 10000 });
    await expect(listbox).toHaveAttribute('role', 'listbox');
    const input = page.locator(HEADER_INPUT).first();
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    // Dropdown carries either suggestions or the view-all row.
    const optionCount = await page.locator(SUGGEST_OPTION).count();
    const viewAllCount = await page.locator(SUGGEST_VIEW_ALL).count();
    expect(optionCount + viewAllCount).toBeGreaterThan(0);
  });

  /**
   * Finding C8 (plan L Phase L3). Suggestions used to arrive with the first
   * item highlighted, so this pressed Enter and could land on a product detail
   * page rather than the results page, which is why the assertion accepted
   * both. Enter with nothing arrowed to now searches the typed text.
   */
  test(`suggest then plain Enter searches the typed text at /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    if (!(await focusHeaderSearch(page))) return;
    await typeQuery(page, 'laptop');
    await expect(page.locator(SUGGEST_LISTBOX)).toBeVisible({ timeout: 10000 });
    const input = page.locator(HEADER_INPUT).first();
    await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
    await input.press('Enter');
    // A predicate rather than a regex: `\?` inside a template literal collapses
    // to a bare `?`, which turns the pattern into an optional character class.
    await page.waitForURL(
      (url) => url.pathname === `/${locale}/search` && url.searchParams.get('q') === 'laptop',
      { timeout: 15000 },
    );
    await expect(page.locator(SEARCH_TITLE)).toBeVisible({ timeout: 15000 });
  });

  test(`suggest then ArrowDown + Enter commits the highlighted item at /${locale}/`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/`);
    if (!(await focusHeaderSearch(page))) return;
    await typeQuery(page, 'laptop');
    await expect(page.locator(SUGGEST_LISTBOX)).toBeVisible({ timeout: 10000 });
    const input = page.locator(HEADER_INPUT).first();
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', /option-0$/);
    await input.press('Enter');
    // The first suggestion is a product or a category, never the results page.
    await page.waitForURL(new RegExp(`/${locale}/catalog/`), { timeout: 15000 });
  });

  test(`Escape closes the suggest dropdown at /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    if (!(await focusHeaderSearch(page))) return;
    await typeQuery(page, 'laptop');
    const listbox = page.locator(SUGGEST_LISTBOX);
    await expect(listbox).toBeVisible({ timeout: 10000 });
    await page.locator(HEADER_INPUT).first().press('Escape');
    await expect(listbox).toBeHidden({ timeout: 5000 });
    await expect(page.locator(HEADER_INPUT).first()).toHaveAttribute('aria-expanded', 'false');
  });

  test(`outside-click closes the suggest dropdown at /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/`);
    if (!(await focusHeaderSearch(page))) return;
    await typeQuery(page, 'laptop');
    const listbox = page.locator(SUGGEST_LISTBOX);
    await expect(listbox).toBeVisible({ timeout: 10000 });
    // Click the page body well outside the header-search shell.
    await page
      .locator('main')
      .first()
      .click({ position: { x: 100, y: 200 }, force: true });
    await expect(listbox).toBeHidden({ timeout: 5000 });
  });

  test(`/search?q=laptop renders title + count + grid at /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/search?q=laptop`);
    await expect(page.locator(SEARCH_TITLE)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(SEARCH_TITLE)).toContainText('laptop');
    const grid = page.locator('[data-testid="catalog-grid"]');
    await expect(grid).toBeVisible({ timeout: 15000 });
    const cards = grid.locator('app-product-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    await expect(page.locator(SEARCH_COUNT)).toBeVisible();
  });

  test(`/search?q=laptop renders a real price on every card at /${locale}/`, async ({ page }) => {
    // `/v1/search` sends the price as `minPrice` and sends no `variants` array.
    // The page read `variants[0].price`, then a `priceMin` no serializer emits,
    // then fell through to a literal 0, so every card on a production search
    // rendered `0,000 DT` while the title, the count and the grid above all
    // stayed green.
    await page.goto(`/${locale}/search?q=laptop`);
    await expect(page.locator('[data-testid="catalog-grid"]')).toBeVisible({ timeout: 15000 });

    const cardCount = await page.locator(CARD).count();
    expect(
      cardCount,
      'the laptop query must return cards for this to judge anything',
    ).toBeGreaterThan(0);

    const rendered = await page.locator(CARD_PRICE).allTextContents();
    // Count equality is the load-bearing half. A card with no resolvable price
    // now renders no price line at all, so a bare "no zeros" assertion would pass
    // most confidently at the exact moment every price vanished.
    expect(rendered.length, 'every search card must render exactly one price').toBe(cardCount);

    const zeros = rendered.filter((text) => renderedAmount(text) === 0);
    expect(zeros, `search cards rendered a zero price: ${JSON.stringify(zeros)}`).toEqual([]);
  });

  test(`/search?q=laptop renders the rating the API sent at /${locale}/`, async ({ page }) => {
    // Same drift, second casualty: the page read `ratingSummary.averageRating` /
    // `.total` while the wire sends `avgRating` / `reviewCount`, so the card saw
    // no review count and hid its stars on every search result. Its own test so a
    // rating regression does not read as a price regression.
    await page.goto(`/${locale}/search?q=laptop`);
    await expect(page.locator('[data-testid="catalog-grid"]')).toBeVisible({ timeout: 15000 });
    expect(await page.locator(`${CARD} app-rating`).count()).toBeGreaterThan(0);
  });

  test(`/search empty path renders the no-results state at /${locale}/`, async ({ page }) => {
    await page.goto(`/${locale}/search?q=zxqxqzxqzxq`);
    await expect(page.locator(SEARCH_TITLE)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="catalog-grid-empty"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="catalog-grid"]')).toHaveCount(0);
  });

  test(`sort change updates URL on /${locale}/search?q=laptop`, async ({ page }) => {
    await page.goto(`/${locale}/search?q=laptop`);
    await expect(page.locator('[data-testid="catalog-grid"]')).toBeVisible({
      timeout: 15000,
    });
    // The grid is server-rendered, so it is visible before the app is
    // interactive, and a `change` fired into that window reaches no listener.
    // Retrying the interaction against the URL it should produce is the only
    // honest wait here: it fails when the app never becomes interactive, which
    // is the real condition, rather than when a fixed budget runs out. Not a
    // sleep and not a bigger timeout — each attempt drives the control again.
    const sort = page.locator('catalog-sort-control select');
    await expect(async () => {
      await sort.selectOption('priceAsc');
      expect(page.url()).toMatch(/sortBy=price/);
    }).toPass({ timeout: 30_000 });
    expect(page.url()).toMatch(/sortOrder=asc/);
  });

  test(`clicking a result card POSTs a search click event on /${locale}/search?q=laptop`, async ({
    page,
  }) => {
    const clickRequests: { url: string }[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (req.method() === 'POST' && /\/v1\/search\/events\/[^/]+\/click$/.test(url)) {
        clickRequests.push({ url });
      }
    });

    // The grid is server-rendered and paints before any listener is attached,
    // and GET /v1/cart fires before hydration ends too. A click in that window
    // follows the anchor like a plain link, the app never sees it, and the
    // tracking POST this test is about never fires.
    await page.goto(`/${locale}/search?q=laptop`);
    const grid = page.locator('[data-testid="catalog-grid"]');
    await expect(grid).toBeVisible({ timeout: 15000 });
    await waitForHydration(page);
    const firstCard = grid.locator('li[data-product-slug]').first();
    const href = await firstCard.locator('a').first().getAttribute('href');
    expect(href).toMatch(new RegExp(`^/${locale}/catalog/product/`));

    // Wait deterministically for the click POST instead of a fixed sleep.
    // `docs/storefront-api-reference.md §Search` — POST /v1/search/events/:id/click
    // is fired by the storefront when a result card is clicked. The search
    // controller reads x-session-id as a header (line 60, Common request headers),
    // NOT a sessionId cookie — the sessionId cookie is only set by the first
    // POST /v1/cart/items (line 68). Anonymous tracking for sessions that have
    // not yet added to cart does not carry a session cookie.
    const clickPostPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && /\/v1\/search\/events\/[^/]+\/click$/.test(req.url()),
      { timeout: 10000 },
    );
    await Promise.all([
      page.waitForURL(href ?? new RegExp(`/${locale}/catalog/product/`), { timeout: 15000 }),
      firstCard.locator('a').first().click(),
    ]);
    await clickPostPromise;
    expect(clickRequests.length).toBeGreaterThanOrEqual(1);
    // Verify the click event URL contains a non-empty eventId segment.
    expect(clickRequests[0].url).toMatch(/\/v1\/search\/events\/[^/]+\/click$/);
  });

  test(`applying a brand filter on /${locale}/search updates URL + count`, async ({ page }) => {
    await page.goto(`/${locale}/search?q=laptop`);
    const grid = page.locator('[data-testid="catalog-grid"]');
    await expect(grid).toBeVisible({ timeout: 15000 });
    // Capture initial result count from the live region.
    const countBefore = (
      await page.locator('[data-testid="search-results-count"]').textContent()
    )?.trim();
    // FilterRailComponent uses an explicit-apply pattern: the radios mutate
    // a draft signal; the URL push fires only when the "Apply" button is
    // clicked (`apps/storefront/src/app/sections/catalog/filter-rail.component.ts:227`).
    const brandRadios = page.locator('catalog-filter-rail input[type="radio"][name="brand"]');
    if ((await brandRadios.count()) === 0) {
      // The current fixture catalogue seed (`prisma/seeds/fixture-catalogue/products.ts`)
      // does not assign `brand:` fields, so `/v1/search/filters` returns
      // zero brand buckets and the FilterRail renders nothing under
      // "Brand". Soft-skip rather than fail; the URL-push + count-update
      // assertion is unit-covered in the search page spec, and the
      // backend e2e at `apps/api/test/search.e2e-spec.ts` covers the
      // `?brand=` filter path against a brand-bearing seed. Seed brands
      // for the fixture catalogue land in a future phase.
      test.skip(true, 'no brand facet rendered for the seeded query');
    }
    await brandRadios.first().check({ force: true });
    await page.locator('catalog-filter-rail .apply').click();
    await page.waitForURL(/brand=/, { timeout: 10000 });
    expect(page.url()).toMatch(/brand=/);
    // Result count is announced via aria-live; assert it changed or that
    // the empty state appears if the filter excluded every hit.
    await page.waitForFunction(
      ([prev]) => {
        const el = document.querySelector('[data-testid="search-results-count"]');
        const empty = document.querySelector('[data-testid="catalog-grid-empty"]');
        return (el && el.textContent?.trim() !== prev) || empty !== null;
      },
      [countBefore],
      { timeout: 10000 },
    );
  });

  test(`axe — zero serious / critical on /${locale}/search?q=laptop`, async ({ page }) => {
    await page.goto(`/${locale}/search?q=laptop`);
    await expect(page.locator(SEARCH_TITLE)).toBeVisible({ timeout: 15000 });
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

  test(`axe — zero serious / critical on /${locale}/search empty path`, async ({ page }) => {
    await page.goto(`/${locale}/search?q=zxqxqzxqzxq`);
    await expect(page.locator('[data-testid="catalog-grid-empty"]')).toBeVisible({
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
 * Plan L Phase L2 - finding C10, absorbing the prior pass's C2.
 *
 * A failing /v1/search was mapped to an empty result set, so an outage told the
 * shopper their query matched nothing. The failure is real here rather than
 * mocked: `q` is capped at 200 characters by the API DTO, so a longer query is
 * a genuine 400 from the real backend and no `page.route()` is involved
 * (constitution 3.8).
 *
 * The retry control is asserted present here but not driven: the storefront's
 * own Zod query schema also caps `q` at 200, so a retry on this query is
 * rejected before it reaches the network and a click would prove nothing. Both
 * retry outcomes are covered in `search/index.page.spec.ts`.
 */
describeEveryLocale('search load failure', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  const OVERLONG_QUERY = 'a'.repeat(201);
  const COPY: Record<string, string> = {
    fr: 'Impossible de charger les résultats',
    en: 'We could not load your search results',
    ar: 'تعذر تحميل نتائج البحث. يرجى المحاولة مرة أخرى.',
  };

  test(`a rejected search renders the error block, not the empty state (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/search?q=${OVERLONG_QUERY}`);

    const error = page.locator('[data-testid="search-error"]');
    await expect(error).toBeVisible({ timeout: 30000 });
    await expect(error).toContainText(copyFor(COPY, locale));
    await expect(page.locator('[data-testid="search-error-retry"]')).toBeVisible();
    await expect(page.locator('[data-testid="catalog-grid-empty"]')).toHaveCount(0);
  });
});
