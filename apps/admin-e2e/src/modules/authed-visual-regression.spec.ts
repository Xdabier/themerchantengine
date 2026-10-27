import { test, expect } from './_auth-fixture';
import { settleLayout } from './settle-layout';

/**
 * Authenticated visual regression — Phase 23.3.
 *
 * Scope: routes whose content is deterministic after the e2e seed
 * (settings, /me, /currencies, /shipping/countries).
 * Transactional routes (orders, products, gift-cards, assets) are
 * intentionally excluded — their row counts + timestamps fluctuate
 * with seed tweaks and would flake the baseline.
 *
 * /staff and /roles are also excluded: the staff-roles.journey.spec.ts
 * creates e2e staff + role entries (with time-based unique suffixes) that
 * appear in these list pages during the same suite run. Because those entries
 * differ on every run the baselines are inherently unstable. Coverage of these
 * routes' functional behaviour is provided by staff-roles.journey.spec.ts.
 *
 * /shipping/countries is also excluded: countries.journey.spec.ts patches
 * the countries state mid-suite (try/finally restore, but restores complete
 * asynchronously across parallel workers). The enabled-country count shown
 * on the page differs across runs when the visual regression snapshot fires
 * while a countries journey test is still in-flight.
 *
 * Baselines live under `src/modules/authed-visual-regression.spec.ts-snapshots/`,
 * platform-suffixed by Playwright. Regenerate via
 * `npx nx e2e admin-e2e --update-snapshots`.
 *
 * These are the dark-mode baselines; the harness pins `colorScheme: 'dark'`
 * so they stay that way. The light-mode set is `light-mode-baselines.spec.ts`,
 * over the same routes and a narrower set of projects.
 */

/**
 * The topbar store identity is masked out of every shot. It renders whatever
 * the store is currently called, a journey renames the store to prove the
 * shell follows it, and these specs run in parallel with that one; pinning it
 * here would make a rename look like a visual regression on seven screens at
 * once. `shell-identity.journey.spec.ts` is what covers it.
 */
const STORE_IDENTITY = '[data-testid="topbar-store-identity"]';

const STABLE_ROUTES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/me', name: 'account-me' },
  { path: '/settings', name: 'settings-home' },
  { path: '/settings/general', name: 'settings-general' },
  { path: '/settings/locales', name: 'settings-locales' },
  { path: '/settings/brand', name: 'settings-brand' },
  { path: '/settings/money', name: 'settings-money' },
  { path: '/settings/domains', name: 'settings-domains' },
  { path: '/settings/appearance', name: 'settings-appearance' },
  { path: '/settings/integrations', name: 'settings-integrations' },
  { path: '/currencies', name: 'currencies' },
];

for (const route of STABLE_ROUTES) {
  test(`matches baseline for ${route.name}`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'networkidle' });

    // Prove we are looking at the screen this baseline names, before comparing
    // a single pixel. A pixel comparison cannot tell "the screen changed" from
    // "the screen never loaded", and on a ground the mode holds across most of
    // its area (constitution 3.9) a login form and a settings grid differ only
    // in the thin glyph layer: when the shared session was revoked mid-run,
    // forty-nine of these reported as two-percent drift rather than as the
    // wrong page entirely.
    await expect(
      page,
      'not authenticated: this is the login page, not ' + route.name,
    ).not.toHaveURL(/\/auth\/login/);
    await expect(
      page.locator('[data-testid="app-shell-main"]'),
      'the admin shell never mounted, so this screenshot is not ' + route.name,
    ).toBeVisible({ timeout: 15_000 });

    await settleLayout(page);

    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.002,
      mask: [page.locator(STORE_IDENTITY)],
    });
  });
}
