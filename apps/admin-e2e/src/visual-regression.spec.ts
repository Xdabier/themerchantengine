import { test, expect } from '@playwright/test';

/**
 * Visual regression baseline for the admin dashboard's **unauthenticated**
 * routes. We only capture routes that don't require a backend session —
 * auth redirects + error pages + the design-system showcase. That's enough
 * to catch brand-token regressions (colour, typography, layout, icons)
 * without needing to seed a full admin user + permissions fixture in
 * globalSetup.
 *
 * Authenticated route coverage is left to a future phase: it requires a
 * running backend or MSW-style HTTP mocking inside the browser, which
 * doubles the e2e footprint.
 *
 * Baselines live under `apps/admin-e2e/__screenshots__/` (Playwright's
 * default location, ignored in git for `-actual-*` and `-diff-*` files —
 * see .gitignore). Baselines **must** be generated on a Linux CI agent to
 * avoid platform-specific font + sub-pixel rendering differences.
 *
 * Re-baseline via:
 *   npx nx e2e admin-e2e --update-snapshots
 *
 * Previously gated on a `VISUAL_REGRESSION=1` env-var for Windows because
 * of a misdiagnosed "Playwright + Angular zoneless bootstrap flake" — actual
 * root cause was a route-ordering bug (`path: ''` with `{ path: '**' }`
 * child eating `/auth/login` into an authGuard redirect loop). Fixed.
 */

const STABLE_ROUTES: readonly { path: string; name: string }[] = [
  { path: '/auth/login', name: 'auth-login' },
  { path: '/auth/forgot', name: 'auth-forgot' },
  { path: '/403', name: 'forbidden' },
  { path: '/404', name: 'not-found' },
  { path: '/dev/design-system', name: 'design-system' },
];

test.describe('Visual regression (public routes)', () => {
  for (const route of STABLE_ROUTES) {
    test(`matches baseline for ${route.name}`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'networkidle' });

      // Wait for Angular to finish the initial CD cycle — signals + zoneless
      // means no NgZone to hook into, so we poll for a stable DOM.
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        fullPage: true,
        // Hide any caret blink / focus ring from throwing diff pixels.
        animations: 'disabled',
        // 0.2% pixel tolerance lets minor font-hinting drift pass while
        // catching genuine visual regressions.
        maxDiffPixelRatio: 0.002,
      });
    });
  }
});
