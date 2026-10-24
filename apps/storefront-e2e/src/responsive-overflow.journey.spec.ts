import { expect, test, type Page } from '@playwright/test';

import {
  attachConsoleBaseline,
  describeEveryLocale,
  expectedDocumentNotFound,
  type ConsoleBaseline,
} from './support';

/**
 * Responsive-overflow audit — storefront-fixture catalogue.
 *
 * Walks the full public route surface across the documented breakpoint
 * matrix (`agent_docs/storefront/responsive-rules.md` §Breakpoints) and
 * asserts no horizontal scroll on the document. A second pass collects
 * per-element overflow offenders for diagnostic reporting.
 *
 * Constitution §3.10 requires the storefront to render without
 * horizontal overflow at every breakpoint in `360 / 390 / 768 / 1024 /
 * 1280 / 1440 / 1920`. This spec enforces that contract.
 *
 * Restricted to the desktop-chromium-1440 project so the matrix stays
 * tractable: 7 viewports × 2 locales × ~17 routes = 238 cells. The
 * mobile-chrome / mobile-safari projects pin a single device viewport
 * each and would just re-run the same rendering path.
 *
 * Authed routes (account/*) and the dynamic order-confirmation route
 * are deferred to a build-gated follow-up — the dev-server SSR cold
 * start makes auth-flow round-trips too slow for this audit's budget
 * (matches the §1.23 / §1.27 gate already in catalog.journey).
 */

const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
] as const;

interface RouteCase {
  /** Path relative to `/[locale]`. Use `''` for the locale root. */
  path: string;
  /** Skip on dev-server context (auth-gated or hits an absent seed slug). */
  buildGated?: boolean;
  /** Allow an element to legitimately scroll horizontally (rails, etc.). */
  allowedHorizontalScrollSelectors?: string[];
}

/**
 * Routes resolved against `/[locale]` prefix. The seed product +
 * category slugs come from `scripts/seed-storefront-test.ts` →
 * `seedFixtureCatalogue` so they are stable across runs.
 */
const ROUTES: RouteCase[] = [
  { path: '' },
  { path: 'about' },
  { path: 'policies/privacy' },
  { path: 'policies/terms' },
  { path: 'policies/returns' },
  { path: 'policies/shipping' },
  { path: 'cart' },
  { path: 'search' },
  { path: 'search?q=laptop' },
  { path: 'auth/login' },
  { path: 'auth/register' },
  { path: 'auth/forgot-password' },
  { path: 'catalog/fx-electronics' },
  { path: 'catalog/product/fx-laptop-pro-16-studio' },
  // 404 surface — exercises the wildcard route + error layout.
  { path: 'no-such-route-7XK' },
  // Account index renders a login redirect server-side; safe without auth.
  { path: 'account', buildGated: true },
  { path: 'account/orders', buildGated: true },
  { path: 'account/wishlist', buildGated: true },
  { path: 'account/addresses', buildGated: true },
  { path: 'account/profile', buildGated: true },
  { path: 'checkout', buildGated: true },
];

const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => {
    if (typeof document !== 'undefined' && 'fonts' in document) {
      await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready;
    }
  });
  // Same hydration floor as visual-regression.journey.spec.ts.
  await page.waitForTimeout(400);
}

interface OverflowReport {
  documentScrollWidth: number;
  innerWidth: number;
  offenders: Array<{ selector: string; scrollWidth: number; clientWidth: number }>;
}

/**
 * Collects:
 *   - Document-level horizontal scroll (always assertable).
 *   - Per-element overflow offenders (diagnostic). Excludes elements
 *     inside known-scrolling rails so legitimate horizontal-scroll
 *     containers do not pollute the report.
 */
async function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const offenders: Array<{ selector: string; scrollWidth: number; clientWidth: number }> = [];
    // B3 deleted the hardcoded rails; the generic `product-rail` tag still
    // covers every scroll-variant FEATURED_PRODUCTS rail.
    const allowed = new Set(['product-rail']);
    const inAllowedScroller = (el: Element): boolean => {
      let cursor: Element | null = el;
      while (cursor) {
        const testid = cursor.getAttribute?.('data-testid');
        if (testid && [...allowed].some((tag) => testid.includes(tag))) return true;
        if (cursor.classList?.contains('rail') || cursor.classList?.contains('scroll-rail')) {
          return true;
        }
        cursor = cursor.parentElement;
      }
      return false;
    };
    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const cls = el.classList.length ? `.${[...el.classList].slice(0, 3).join('.')}` : '';
      const testid = el.getAttribute('data-testid');
      const tid = testid ? `[data-testid="${testid}"]` : '';
      return `${tag}${id}${cls}${tid}`;
    };
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      if (!(el instanceof HTMLElement)) continue;
      if (inAllowedScroller(el)) continue;
      const sw = el.scrollWidth;
      const cw = el.clientWidth;
      if (cw > 0 && sw - cw > 1) {
        offenders.push({ selector: describe(el), scrollWidth: sw, clientWidth: cw });
        if (offenders.length >= 10) break;
      }
    }
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders,
    };
  });
}

/**
 * Asserts every product card in a catalog grid renders to the same
 * outer height — the grid relies on uniform cells (a card with rating +
 * delivery line and a card with neither must occupy the same vertical
 * space, otherwise the grid alignment skews and the design floor §7
 * "Scan" rule breaks). Tolerance: 1 px to absorb sub-pixel rounding.
 */
async function assertEqualCardHeights(page: Page, gridSelector: string): Promise<void> {
  const breakdown = await page.evaluate((sel) => {
    const grid = document.querySelector(sel);
    if (!grid) return null;
    const cards = Array.from(grid.querySelectorAll('app-product-card'));
    return cards.map((c) => {
      const r = (c as HTMLElement).getBoundingClientRect();
      const card = c.querySelector('.card') as HTMLElement | null;
      const image = c.querySelector('.image-link') as HTMLElement | null;
      const meta = c.querySelector('.meta') as HTMLElement | null;
      const title = c.querySelector('.title') as HTMLElement | null;
      const rating = c.querySelector('.rating-slot') as HTMLElement | null;
      const price = c.querySelector('app-price') as HTMLElement | null;
      const compareAt = c.querySelector('app-price .compare-at') as HTMLElement | null;
      const delivery = c.querySelector('.delivery') as HTMLElement | null;
      const ratingComp = c.querySelector('app-rating') as HTMLElement | null;
      return {
        host: Math.round(r.height),
        card: card ? Math.round(card.getBoundingClientRect().height) : -1,
        image: image ? Math.round(image.getBoundingClientRect().height) : -1,
        meta: meta ? Math.round(meta.getBoundingClientRect().height) : -1,
        title: title ? Math.round(title.getBoundingClientRect().height) : -1,
        ratingSlot: rating ? Math.round(rating.getBoundingClientRect().height) : -1,
        ratingComp: ratingComp ? Math.round(ratingComp.getBoundingClientRect().height) : 0,
        price: price ? Math.round(price.getBoundingClientRect().height) : -1,
        hasCompareAt: !!compareAt,
        delivery: delivery ? Math.round(delivery.getBoundingClientRect().height) : -1,
      };
    });
  }, gridSelector);
  expect(breakdown, `no cards found in ${gridSelector}`).not.toBeNull();
  expect(breakdown!.length, `at least 2 cards needed in ${gridSelector}`).toBeGreaterThanOrEqual(2);
  const heights = breakdown!.map((b) => b.host);
  const max = Math.max(...heights);
  const min = Math.min(...heights);
  expect(
    max - min,
    `card heights drift ${max - min}px in ${gridSelector} — breakdown:\n${JSON.stringify(breakdown, null, 2)}`,
  ).toBeLessThanOrEqual(1);
}

describeEveryLocale('storefront responsive — equal product-card heights', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[5]] as const) {
    test(`/${locale}/catalog/fx-electronics @ ${viewport.name} — uniform card heights`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // Warm the SSR via home first so the cold-start of /catalog/<slug>
      // does not exceed the per-test budget on the Vite dev-server tier
      // (matches the §1.23 + §1.27 pattern catalog.journey.spec.ts uses).
      await page.goto(`/${locale}/`);
      await page.waitForLoadState('networkidle');
      await page.goto(`/${locale}/catalog/fx-electronics`);
      await page.waitForSelector('[data-testid="catalog-grid"] app-product-card', {
        timeout: 45_000,
      });
      await settle(page);
      await assertEqualCardHeights(page, '[data-testid="catalog-grid"]');
    });
  }
});

describeEveryLocale('storefront responsive — no horizontal overflow', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  let currentPage: Page;
  test.beforeEach(({ page }) => {
    currentPage = page;
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    // `no-such-route-7XK` is in ROUTES on purpose: the not-found surface has to
    // fit its viewport too. It answers a real 404 now, and the browser logs the
    // document's own status, which the baseline would otherwise fail on. Keyed
    // on the resource URL being the document, so a 404 on an image or an API
    // call in any of these routes still fails.
    baseline.assertClean({ ignore: [expectedDocumentNotFound(currentPage)] });
  });

  for (const route of ROUTES) {
    for (const viewport of VIEWPORTS) {
      const cellName = `/${locale}/${route.path} @ ${viewport.name}`;
      test(cellName, async ({ page }) => {
        if (route.buildGated && !STOREFRONT_E2E_BUILT) {
          test.skip(true, 'authed/dynamic route — build-gated per S6 §1.23 pattern');
        }
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const url = route.path ? `/${locale}/${route.path}` : `/${locale}/`;
        const response = await page.goto(url, { timeout: 60_000 });
        // Any non-server-error response is acceptable — the audit is
        // for layout overflow, not HTTP semantics. The Analog
        // `[...not-found]` route currently renders the 404 page with a
        // 200 status (framework behaviour) so we only guard against
        // hard 5xx errors that would mean SSR died and the overflow
        // measurement is meaningless.
        expect(response?.status() ?? 0, `nav to ${url}`).toBeLessThan(500);
        await settle(page);

        const report = await measureOverflow(page);

        // Allow a 1px sub-pixel rounding tolerance (matches Chromium's
        // own scrollWidth quantization on fractional viewport widths).
        expect(
          report.documentScrollWidth,
          `document overflows viewport at ${cellName}\noffenders:\n${JSON.stringify(report.offenders, null, 2)}`,
        ).toBeLessThanOrEqual(report.innerWidth + 1);
      });
    }
  }
});

/**
 * Overlay surfaces the route sweep above cannot reach: they only exist after an
 * interaction, so a route-level pass says nothing about them. Plan N2 opens a
 * fullscreen lightbox over the product page, and a full-viewport overlay is
 * exactly the kind of surface that overflows its own viewport at 360.
 */
describeEveryLocale('storefront responsive, open overlays', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`/${locale} header menu drawer @ mobile-360, no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    const response = await page.goto(`/${locale}/`, { timeout: 60_000 });
    expect(response?.status() ?? 0, `nav to /${locale}/`).toBeLessThan(500);
    await settle(page);

    const toggle = page.locator('[data-testid="header-menu-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await toggle.click();
    await expect(page.locator('[data-testid="header-menu-drawer"]')).toBeVisible({
      timeout: 30_000,
    });
    await settle(page);

    const report = await measureOverflow(page);
    expect(
      report.documentScrollWidth,
      `open menu drawer overflows viewport at mobile-360\noffenders:\n` +
        JSON.stringify(report.offenders, null, 2),
    ).toBeLessThanOrEqual(report.innerWidth + 1);
  });

  for (const viewport of [VIEWPORTS[0], VIEWPORTS[6]] as const) {
    test(`/${locale} product lightbox @ ${viewport.name}, no horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const url = `/${locale}/catalog/product/fx-watch-active-watch-pro`;
      const response = await page.goto(url, { timeout: 60_000 });
      expect(response?.status() ?? 0, `nav to ${url}`).toBeLessThan(500);
      await settle(page);

      await page.locator('product-gallery .zoom').click();
      await expect(page.locator('product-gallery dialog.lightbox')).toBeVisible({
        timeout: 30_000,
      });
      await settle(page);

      const report = await measureOverflow(page);
      expect(
        report.documentScrollWidth,
        `open lightbox overflows viewport at ${viewport.name}
offenders:
` + JSON.stringify(report.offenders, null, 2),
      ).toBeLessThanOrEqual(report.innerWidth + 1);
    });
  }
});
