import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  STOREFRONT_LOCALES,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  directionOf,
  waitForHydration,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';

/**
 * Phase S4 — layout-shell journey.
 *
 * Boots against the real test API (no fixtures, no `page.route()` per
 * constitution §3.8) and exercises the layout-shell wiring:
 *
 *  - Locale switch via the header language toggle preserves the path and
 *    swaps `lang`. Both supported locales are left-to-right, so `dir` reads
 *    `ltr` on either side of the switch: the assertion stays because it is
 *    the tripwire for a resurrected RTL branch, not because it changes.
 *  - The brand lockup is locale-invariant (one Latin-script wordmark serves
 *    both locales), asserted as "same asset before and after the switch"
 *    rather than as a per-locale filename.
 *  - Locale switch via the footer language toggle behaves identically.
 *  - Path preservation across deeply-nested URLs with query + fragment.
 *  - Cart icon at count=0 hides the badge entirely.
 *  - axe is clean across the journey.
 */

test.describe('storefront S4 layout shell', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test('header language toggle swaps lang, keeps dir=ltr, keeps the lockup', async ({ page }) => {
    await page.goto('/fr/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'fr');
    await expect(html).toHaveAttribute('dir', directionOf('fr'));

    const headerLockup = page.locator('header[role="banner"] .lockup img').first();
    const lockupBefore = await headerLockup.getAttribute('src');
    expect(lockupBefore ?? '').toMatch(/^\/brand\//);

    await waitForHydration(page);
    const toggle = page.locator('[data-testid="header-language-toggle"]');
    await expect(toggle).toBeVisible();
    await toggle.click();
    const option = page.locator('[data-testid="header-language-option-en"]');
    await expect(option).toBeVisible();
    await Promise.all([page.waitForURL(/\/en\//), option.click()]);

    await expect(html).toHaveAttribute('lang', 'en');
    // Asserting the direction on both sides of the switch is what catches a
    // toggle that changes the language and leaves the direction behind, which
    // is a real defect on a store that serves one RTL locale and one LTR.
    await expect(html).toHaveAttribute('dir', directionOf('en'));
    const headerLockupAfter = page.locator('header[role="banner"] .lockup img').first();
    await expect(headerLockupAfter).toHaveAttribute('src', lockupBefore ?? '');
  });

  test('footer language toggle preserves a deep route + query + fragment', async ({
    page,
    context,
  }) => {
    await page.goto('/en/_smoke/services?ref=test');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');

    await waitForHydration(page);
    const footerToggle = page.locator('[data-testid="footer-language-toggle"]');
    await expect(footerToggle).toBeVisible();
    await footerToggle.click();
    const footerOption = page.locator('[data-testid="footer-language-option-fr"]');
    // Verify the option builds the correct href. This is the core contract.
    await expect(footerOption).toHaveAttribute('href', '/fr/_smoke/services?ref=test');
    // The menu opens at the start edge of a full-width row; it must not be
    // drawn past the viewport, where the page cannot scroll to it.
    const box = await footerOption.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

    // Follow the href on a FRESH page rather than navigating this one.
    //
    // Two reasons, and the second is the one that bites. A click here fires a
    // real HTML navigation and the Vite dev server can cold-start the new
    // route past the budget on mobile engines. And navigating this page away
    // aborts the module imports the first route still has in flight, which
    // rejects a dynamic import into StorefrontErrorHandler and fails the
    // console baseline in teardown even though every assertion passed. A new
    // page has nothing in flight to abort, and following a link from a fresh
    // load is what a reader does anyway.
    const toggleHref = (await footerOption.getAttribute('href')) ?? '';
    expect(toggleHref).toBe('/fr/_smoke/services?ref=test');
    const followed = await context.newPage();
    // The outer baseline is bound to `page`, so the new one needs its own or
    // an error on the followed render would go unseen.
    const followedBaseline = attachConsoleBaseline(followed);
    try {
      await followed.goto(toggleHref);
      const followedHtml = followed.locator('html');
      await expect(followedHtml).toHaveAttribute('lang', 'fr');
      await expect(followedHtml).toHaveAttribute('dir', directionOf('fr'));

      // Path preserved exactly; query string preserved too.
      expect(followed.url()).toContain('/fr/_smoke/services?ref=test');
      followedBaseline.assertClean();
    } finally {
      await followed.close();
    }
  });

  test('cart icon is reachable; badge is hidden at count=0', async ({ page }) => {
    await page.goto('/fr/');
    const cartIcon = page.locator('[data-testid="header-cart"]');
    await expect(cartIcon).toBeVisible();

    const badge = page.locator('[data-testid="header-cart-badge"]');
    await expect(badge).toHaveCount(0);
  });

  // One locale per test, deliberately.
  //
  // This used to visit /fr/ and then /en/ in a single body, and `page.goto`
  // resolves on `load`, which does not wait for the modules the app requests
  // afterwards. The second navigation aborted the first route's in-flight
  // imports, the rejected dynamic import reached StorefrontErrorHandler, and
  // the console baseline correctly failed the test in teardown while its own
  // assertions passed. Waiting harder is the wrong fix: `networkidle` never
  // settles against the dev server's open HMR socket, and waiting on rendered
  // content does not prove the chunk graph is finished. Not navigating away
  // mid-flight removes the condition instead of timing around it.
  for (const locale of STOREFRONT_LOCALES) {
    test(`skip-link target is the locale-keyed main id (${locale})`, async ({ page }) => {
      // The href must be path-prefixed so `<base href="/">` does not rewrite a
      // bare `#main-<locale>` to `/#main-<locale>`, which redirects through the
      // root locale-resolver and lands users on a 404 instead of focusing main.
      await page.goto(`/${locale}/`);
      await expect(page.locator('a.skip-link')).toHaveAttribute(
        'href',
        `/${locale}/#main-${locale}`,
      );
    });
  }

  test('mobile bottom nav active state — home on bare locale root', async ({ page, viewport }) => {
    await page.goto('/en/');
    const home = page.locator('[data-testid="bottom-nav-home"]');
    if ((viewport?.width ?? 0) < 768) {
      // Mobile viewport: nav is rendered + visible, home tab is current.
      await expect(home).toBeVisible();
      await expect(home).toHaveAttribute('aria-current', 'page');
    } else {
      // Desktop viewport: nav still mounted in the DOM but display:none.
      // Assert it is not visible to confirm the responsive guard fires.
      await expect(home).toBeHidden();
    }
  });

  test('axe — zero serious / critical violations across the shell', async ({ page }) => {
    await page.goto('/fr/');
    await injectAxe(page);
    await checkA11y(page, undefined, {
      detailedReport: false,
      axeOptions: {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      },
    });
  });
});

/**
 * N5 (finding M3). The header was logo, search, language, account and cart,
 * with a single "Shop" link and no `<nav>` anywhere. The only category strip
 * lived on `/catalog`, and below 768 px the header search is hidden too, so a
 * phone visitor had no browse entry at all.
 *
 * Runs under both locales: every label here is translated, and the hrefs are
 * locale-prefixed.
 */
const CATEGORY_NAV = '[data-testid="header-category-nav"]';
const MENU_TOGGLE = '[data-testid="header-menu-toggle"]';
const MENU_DRAWER = '[data-testid="header-menu-drawer"]';
const NAV_ALL = '[data-testid="header-nav-all"]';

const NAV_LABELS: Partial<
  Record<StorefrontLocale, { landmark: string; all: string; menu: string }>
> = {
  fr: {
    landmark: 'Catégories de produits',
    all: 'Tous les produits',
    menu: 'Parcourir les catégories',
  },
  en: { landmark: 'Product categories', all: 'All products', menu: 'Browse categories' },
  ar: { landmark: 'فئات المنتجات', all: 'كل المنتجات', menu: 'تصفح الفئات' },
};

/** Slugs of the visible top-level categories, straight off the endpoint the
 * nav reads, so a reseed moves this spec with it. */
async function topLevelSlugs(request: {
  get: (url: string) => Promise<{ ok: () => boolean; json: () => Promise<unknown> }>;
}): Promise<string[]> {
  const res = await request.get(`${STOREFRONT_API_BASE}/v1/categories`);
  expect(res.ok(), 'GET /v1/categories must answer for the nav row').toBe(true);
  const body = (await res.json()) as { data?: unknown };
  const rows: unknown[] = Array.isArray(body.data) ? body.data : [];
  return rows
    .filter((row) => (row as { parentId?: unknown }).parentId == null)
    .map((row) => (row as { slug?: unknown }).slug)
    .filter((slug): slug is string => typeof slug === 'string');
}

describeEveryLocale('storefront N5 header catalogue navigation', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`every page offers a catalogue entry (${locale})`, async ({ page, request, viewport }) => {
    const slugs = await topLevelSlugs(request);
    expect(slugs.length, 'the seed must expose visible top-level categories').toBeGreaterThan(0);
    const labels = copyFor(NAV_LABELS, locale);
    const isMobile = (viewport?.width ?? 1440) < 768;

    // A product page, not the catalogue: this is exactly where the visitor
    // used to have nowhere to go sideways.
    await page.goto(`/${locale}/catalog/${slugs[0]}`);

    if (isMobile) {
      const toggle = page.locator(MENU_TOGGLE);
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toHaveAttribute('aria-label', labels.menu);
      await expect(page.locator(CATEGORY_NAV)).toBeHidden();

      await toggle.click();
      const drawer = page.locator(MENU_DRAWER);
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('..')).toHaveAttribute('role', 'dialog');
      await expect(drawer.getByRole('link', { name: labels.all })).toBeVisible();

      // The drawer fades in, and axe computes contrast against whatever alpha
      // the panel happens to be at when it samples. Settle the animation first
      // or the check is a coin flip (it was, on WebKit).
      await page.evaluate(() =>
        Promise.all(
          document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
        ),
      );

      await injectAxe(page);
      await checkA11y(page, undefined, {
        detailedReport: false,
        includedImpacts: ['serious', 'critical'],
        axeOptions: {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        },
      });

      await drawer.locator(`a[href="/${locale}/catalog/${slugs[0]}"]`).first().click();
      await page.waitForURL(new RegExp(`/${locale}/catalog/${slugs[0]}$`));
      // A panel left open over the destination would trap focus on a page the
      // visitor already left.
      await expect(page.locator(MENU_DRAWER)).toHaveCount(0);
      await expect(toggle).toBeFocused();
      return;
    }

    const nav = page.locator(CATEGORY_NAV);
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await expect(nav).toHaveAttribute('aria-label', labels.landmark);
    await expect(page.locator(NAV_ALL)).toHaveText(labels.all);
    await expect(page.locator(NAV_ALL)).toHaveAttribute('href', `/${locale}/catalog`);
    // The category the visitor is on is the one marked current.
    await expect(nav.locator(`a[href="/${locale}/catalog/${slugs[0]}"]`).first()).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator(MENU_TOGGLE)).toBeHidden();

    // Following one has to land on that category's page, which is the whole
    // point of the row existing.
    const target = slugs[1] ?? slugs[0];
    await nav.locator(`a[href="/${locale}/catalog/${target}"]`).first().click();
    await page.waitForURL(new RegExp(`/${locale}/catalog/${target}$`));
    await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
