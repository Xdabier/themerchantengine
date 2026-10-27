import { test, expect } from './_auth-fixture';
import { checkA11y, injectAxe } from 'axe-playwright';

import { settleLayout } from './settle-layout';

/**
 * The same stable routes as `authed-visual-regression.spec.ts`, rendered in
 * light mode.
 *
 * A separate file rather than a describe block inside that one, because that
 * spec's filename matches nine Playwright projects (`visual-regression` is
 * unanchored in their `testMatch`), so a light block there would record
 * sixty-three more baselines for a mode whose failures are colour failures.
 * The contrast probe measures colour directly and per pair; what a screenshot
 * adds is layout, and layout does not change with the mode. This filename is
 * matched by `authed-desktop` and `authed-mobile` only, which is the
 * decision recorded in `specs/features/cli-brand-agnostic-setup/tasks.md`.
 *
 * `colorScheme: 'light'` is what drives it: no `admin-theme` key is stored in
 * the shared session state, so the boot script falls through to the media
 * query, which is the same path a first-time operator on a light system
 * takes.
 */
test.use({ colorScheme: 'light' });

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
  test(`matches the light baseline for ${route.name}`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'networkidle' });

    await expect(
      page,
      'not authenticated: this is the login page, not ' + route.name,
    ).not.toHaveURL(/\/auth\/login/);
    await expect(
      page.locator('[data-testid="app-shell-main"]'),
      'the admin shell never mounted, so this screenshot is not ' + route.name,
    ).toBeVisible({ timeout: 15_000 });

    // Prove the mode before comparing a pixel. A light baseline recorded from
    // a dark render is a baseline that passes forever and checks nothing.
    await expect(
      page.locator('html'),
      'the page did not render in light mode, so this is not a light baseline',
    ).toHaveAttribute('data-theme', 'light');

    // Axe here rather than in a spec of its own: this is the only place that
    // visits every authed route in light mode, and the harness pins dark
    // everywhere else, so without it light mode would have one audited route.
    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: false });

    await settleLayout(page);

    await expect(page).toHaveScreenshot(`${route.name}-light.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.002,
      mask: [page.locator(STORE_IDENTITY)],
    });
  });
}
