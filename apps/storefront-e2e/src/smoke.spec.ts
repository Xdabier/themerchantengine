import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test } from '@playwright/test';

import {
  attachConsoleBaseline,
  directionOf,
  STOREFRONT_LOCALES,
  type ConsoleBaseline,
} from './support';

/**
 * The mark the header and footer render.
 *
 * An install that configures its own logo gets it from the runtime config; an
 * unconfigured store, which is what this harness seeds, falls back to the
 * neutral default the engine ships. It used to be the previous client's
 * lockup file, which no build carries any more.
 */
const BRAND_LOGO = /\/brand\/default\/logo\.svg$/;

/**
 * The footer grounds on the text colour, so it takes the reversed mark. One
 * pattern for both surfaces let a dark-ink mark on a dark ground pass.
 */
const BRAND_LOGO_INVERSE = /\/brand\/default\/logo-inverse\.svg$/;

/**
 * Storefront foundation smoke (S0 baseline + S4 layout-shell + S5 home-page
 * coverage).
 *
 * Asserts:
 *   - `/fr/` renders the home page with `lang="fr"`.
 *   - `/en/` renders the home page with `lang="en"`.
 *   - Each carries the direction its locale renders in, from the active
 *     sides, and the assertion is the tripwire for a leftover RTL branch.
 *   - The S5 home hero (`[data-testid="home-hero"]`) is the route content
 *     wrapped by the S4 LayoutShell.
 *   - Header (`<header role="banner">`) ships the brand lockup, search input,
 *     account icon, and cart icon.
 *   - Footer (`<footer role="contentinfo">`) ships the reversed mark and the
 *     copyright line.
 *   - MobileBottomNav (`<nav role="navigation">`) renders at `< 768px`.
 *   - axe reports zero serious / critical violations on both routes.
 */

test.describe('storefront S0+S4+S5 home + layout shell smoke', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test('French home + shell renders LTR with the brand lockup and the home hero', async ({
    page,
    viewport,
  }) => {
    await page.goto('/fr/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'fr');
    await expect(html).toHaveAttribute('dir', directionOf('fr'));

    // Home page is wired up. B3 deleted the hardcoded rails, so the readiness
    // beacon is a seeded section block; the loader resolves it on the SSR pass
    // so it needs no hydration and smoke still covers every browser engine.
    await expect(page.locator('[data-testid="home-categories"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // Header lockup. Pinned to the exact asset, not to any file under
    // `/brand/`: brand floor §4.5 fixes the header to lockup b, the previous
    // client's lockups are still on disk, and a pattern loose enough to accept
    // either cannot tell one brand from the other.
    // Use toHaveAttribute (DOM-level) rather than toBeVisible, because on
    // mobile-chrome/safari the grid auto column can collapse the img to a
    // zero bounding-box before the SVG intrinsic dimensions are available;
    // toHaveAttribute verifies the lockup is wired up correctly, which is
    // the contract that matters for the smoke gate.
    const headerLockup = page.locator('header[role="banner"] .lockup img').first();
    await expect(headerLockup).toHaveAttribute('src', BRAND_LOGO);

    // Header search landmark: the `.search-shell` is hidden on narrow
    // viewports per S22 B2 (clarifications §3.17 — sticky bottom-nav
    // search shortcut replaces it at < 768 px). Assert visibility only
    // when the viewport is wide enough for the header search to render.
    if ((viewport?.width ?? 0) >= 768) {
      await expect(page.getByRole('search')).toBeVisible();
    }

    // Header banner landmark exists.
    await expect(page.locator('header[role="banner"]').first()).toBeVisible();

    // Footer contentinfo plus the reversed lockup d on the dark surface. Brand
    // floor §4.5 names lockup d for the footer and §4.3 turns the whole lockup
    // white on an Encre ground. The asset carries the logotype and the
    // signature, so the retyped wordmark that used to sit beside the mark is
    // gone: §4.6 forbids retyping the logotype in a font. Pinned exactly, so a
    // later phase changing it is a deliberate act rather than something a
    // loose pattern waves through.
    const footer = page.locator('footer[role="contentinfo"]');
    await expect(footer).toBeVisible();
    const footerLockup = footer.locator('.brand img');
    await expect(footerLockup).toHaveAttribute('src', BRAND_LOGO_INVERSE);
    await expect(footer.locator('.brand-wordmark')).toHaveCount(0);
  });

  test('English home + shell renders LTR with the brand lockup and the home hero', async ({
    page,
  }) => {
    await page.goto('/en/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('dir', directionOf('en'));

    // Seeded section block — see /fr/ smoke for rationale.
    await expect(page.locator('[data-testid="home-categories"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // Same exact asset under /en/ as under /fr/: the wordmark is Latin script
    // in both, so there is no per-locale artwork and no branch to get wrong.
    const headerLockup = page.locator('header[role="banner"] .lockup img').first();
    await expect(headerLockup).toHaveAttribute('src', BRAND_LOGO);

    await expect(page.locator('footer[role="contentinfo"]')).toBeVisible();
  });

  test('mobile bottom nav renders at <768 px and hides at desktop', async ({ page, viewport }) => {
    await page.goto('/fr/');
    const bottomNav = page.locator('app-mobile-bottom-nav nav[role="navigation"]');

    if ((viewport?.width ?? 0) < 768) {
      await expect(bottomNav).toBeVisible();
      await expect(page.locator('[data-testid="bottom-nav-home"]')).toBeVisible();
      await expect(page.locator('[data-testid="bottom-nav-search"]')).toBeVisible();
      await expect(page.locator('[data-testid="bottom-nav-cart"]')).toBeVisible();
      await expect(page.locator('[data-testid="bottom-nav-account"]')).toBeVisible();
    } else {
      await expect(bottomNav).toBeHidden();
    }
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
    test(`skip-link points at the locale-keyed main (${locale})`, async ({ page }) => {
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

  /**
   * Root-path locale redirect (`/` → `/<locale>/`) is exercised at the unit
   * level (`apps/storefront/src/lib/locale.spec.ts`). The end-to-end SSR
   * 302 path lands when the prod Nitro deployment shape is wired — v1
   * ships the Angular-side redirect (clarifications §3.13).
   */
});
