import { test, expect } from './_auth-fixture';
import { checkA11y, injectAxe } from 'axe-playwright';
import { assertNoObjectObjectLeak } from './_helpers';

/**
 * QA D5 — every registered route is reachable by mouse.
 *
 * `/checkout-settings`, `/shipping/countries` and `/seo/health` were registered
 * and working but absent from the sidebar, and there was no account menu at all
 * so an operator could not open their own profile or enrol two-factor auth.
 *
 * Runs as the seeded superadmin, so `filterNav` keeps every entry.
 */

const SIDEBAR_DESTINATIONS: ReadonlyArray<{ label: string; path: string; testId: string }> = [
  { label: 'Checkout settings', path: '/checkout-settings', testId: 'checkout-settings-page' },
  { label: 'Countries', path: '/shipping/countries', testId: 'countries-page' },
  { label: 'SEO health', path: '/seo/health', testId: 'seo-health-page' },
];

for (const dest of SIDEBAR_DESTINATIONS) {
  test(`sidebar reaches ${dest.path}`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="app-shell-sidebar"]')).toBeVisible({
      timeout: 15_000,
    });

    await page
      .locator('[data-testid="app-shell-sidebar"]')
      .getByRole('link', { name: dest.label, exact: true })
      .click();

    await page.waitForURL((url) => url.pathname === dest.path, { timeout: 15_000 });
    await expect(page.locator(`[data-testid="${dest.testId}"]`)).toBeVisible({ timeout: 15_000 });
    await assertNoObjectObjectLeak(page);
  });
}

test('topbar account menu opens the profile and two-factor screens', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const account = page.locator('[data-testid="topbar-account"]');
  await expect(account).toBeVisible({ timeout: 15_000 });
  await expect(account).toHaveAttribute('aria-haspopup', 'menu');

  await account.click();
  await expect(page.locator('[data-testid="topbar-account-menu"]')).toBeVisible();
  await page.locator('[data-testid="topbar-account-profile"]').click();
  await page.waitForURL((url) => url.pathname === '/me', { timeout: 15_000 });
  await expect(page.locator('[data-testid="me-page"]')).toBeVisible({ timeout: 15_000 });
  await assertNoObjectObjectLeak(page);

  await account.click();
  await page.locator('[data-testid="topbar-account-security"]').click();
  await page.waitForURL((url) => url.pathname === '/me/security', { timeout: 15_000 });
  await expect(page.locator('[data-testid="two-factor-setup"]')).toBeVisible({ timeout: 15_000 });
  await assertNoObjectObjectLeak(page);
});

test('sign out stays a one-click button beside the account menu', async ({ page }) => {
  // Regression guard for plan D, K6: moving sign-out inside the menu would
  // break every existing logout journey for zero operator value.
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="topbar-logout"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="topbar-account-menu"]')).toHaveCount(0);
});

test('the shell chrome itself is axe-clean', async ({ page }) => {
  // This is the one journey dedicated to the sidebar and the topbar, and it
  // carried no axe assertion, so a violation in the chrome had nothing here to
  // fail. Every other journey scans the chrome incidentally on its own route,
  // which means a finding lands on whichever screen happened to run first.
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="app-shell-sidebar"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="app-topbar"]')).toBeVisible();
  await injectAxe(page);
  await checkA11y(page, undefined, { detailedReport: false });
});
