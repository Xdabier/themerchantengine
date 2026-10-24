/*
 * hardening-waived: describeEveryLocale, reloadAndAssertClean. This suite
 * compares stored screenshots; the auth helpers here exist only to reach the
 * authenticated pages it photographs, not to mutate anything. Its own project
 * matrix already drives every viewport and locale it needs, and a reload would
 * re-shoot the same pixels.
 */
import { expect, test } from '@playwright/test';

import {
  attachAuthToBrowser,
  attachConsoleBaseline,
  describeEveryLocale,
  signInViaApi,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S14 — visual regression baselines.
 *
 * Captures pixel baselines on stable storefront routes per plan §S14
 * task 6 (apps/storefront/lighthouserc.cjs counterpart for performance;
 * this file owns the visual side). Three viewports per route × two
 * locales (`fr` + `en`, both left-to-right). Runs under all three Playwright
 * projects per playwright.config.ts (desktop-chromium-1440 +
 * mobile-chrome + mobile-safari) so cross-engine rendering is captured
 * — 18 baselines per route family.
 *
 * Routes:
 *   - /[locale]/cart                  — empty cart, anonymous (always)
 *   - /[locale]/account/orders        — authed (build-gated)
 *   - /[locale]/account/wishlist      — authed (build-gated)
 *
 * Authed routes inherit the §1.27 + §1.23 build-gate: the dev-server
 * cold-start budget is too tight under parallel-worker contention; the
 * production-build context (`STOREFRONT_E2E_BUILT=1`) is the venue
 * where authed visual regression exercises.
 *
 * Snapshot tolerance: 1 % maxDiffPixelRatio (set in
 * playwright.config.ts `expect.toHaveScreenshot` block) absorbs
 * sub-pixel font jitter without masking real UI breakage. Time-based
 * regions are masked per-test where present.
 */

const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 800 },
] as const;

const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';
const SEED_EMAIL = 'cod-test+fixture@fixture.test';
const SEED_PASSWORD = 'Fixture-Test-123!';

async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('domcontentloaded');
  // Ensure web fonts are loaded so Baloo 2 / Inter / JetBrains Mono vs the
  // system fallback does not flicker the baseline. `document.fonts.ready`
  // resolves once every @font-face declaration has loaded or errored.
  await page.evaluate(async () => {
    if (typeof document !== 'undefined' && 'fonts' in document) {
      await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready;
    }
  });
  // Wait for the settled state itself, not for a duration.
  //
  // This used to be a bare `waitForTimeout`, raised 50 -> 200 -> 400 ms as each
  // value flaked in turn. A fixed wait standing in for a condition cannot be
  // tuned into correctness: it either wastes time or captures mid-hydration,
  // and when it captures mid-hydration under `--update-snapshots` it freezes a
  // loading frame into the reference image, so the test then passes forever
  // against the wrong picture. That is exactly what happened to the French
  // mobile-safari cart baseline at D6.
  //
  // Every async surface in the storefront marks its pending state with a
  // `*-loading` testid, so the settled condition is simply that none remain.
  await expect(page.locator('[data-testid$="-loading"]')).toHaveCount(0, { timeout: 20_000 });
  // A short paint flush after the condition clears, for the OnPush pass that
  // renders the settled markup.
  await page.waitForTimeout(250);
}

describeEveryLocale('storefront S14 visual regression — empty cart (anonymous)', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  for (const viewport of VIEWPORTS) {
    test(`/[${locale}]/cart at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/${locale}/cart`);
      await settle(page);
      await expect(page).toHaveScreenshot(`cart-${locale}-${viewport.name}.png`, {
        fullPage: true,
      });
    });
  }
});

describeEveryLocale('storefront S15 visual regression — about + privacy SSG', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  for (const viewport of VIEWPORTS) {
    test(`/[${locale}]/about at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/${locale}/about`);
      await settle(page);
      await expect(page).toHaveScreenshot(`about-${locale}-${viewport.name}.png`, {
        fullPage: true,
      });
    });

    test(`/[${locale}]/policies/privacy at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/${locale}/policies/privacy`);
      await settle(page);
      await expect(page).toHaveScreenshot(`policy-privacy-${locale}-${viewport.name}.png`, {
        fullPage: true,
      });
    });
  }
});

if (STOREFRONT_E2E_BUILT) {
  describeEveryLocale(
    'storefront S14 visual regression — authed account (build-gated)',
    (locale) => {
      // Console + uncaught-error baseline mandated by
      // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
      let baseline: ConsoleBaseline;
      test.beforeEach(({ page }) => {
        baseline = attachConsoleBaseline(page);
      });
      test.afterEach(() => {
        baseline.assertClean();
      });

      for (const viewport of VIEWPORTS) {
        test(`/[${locale}]/account/orders at ${viewport.name}`, async ({ page, request }) => {
          const auth = await signInViaApi(request, SEED_EMAIL, SEED_PASSWORD);
          await attachAuthToBrowser(page, auth);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.goto(`/${locale}/account/orders`);
          await settle(page);
          await expect(page).toHaveScreenshot(`account-orders-${locale}-${viewport.name}.png`, {
            fullPage: true,
            // Order numbers + dates vary by seed run; mask both columns.
            mask: [page.locator('time'), page.locator('[data-testid="order-row-number"]')],
          });
        });

        test(`/[${locale}]/account/wishlist at ${viewport.name}`, async ({ page, request }) => {
          const auth = await signInViaApi(request, SEED_EMAIL, SEED_PASSWORD);
          await attachAuthToBrowser(page, auth);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.goto(`/${locale}/account/wishlist`);
          await settle(page);
          await expect(page).toHaveScreenshot(`account-wishlist-${locale}-${viewport.name}.png`, {
            fullPage: true,
          });
        });
      }
    },
  );
}
