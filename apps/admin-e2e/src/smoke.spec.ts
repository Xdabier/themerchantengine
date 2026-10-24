import { test, expect } from '@playwright/test';

/**
 * Smoke test — loads the public login page and confirms the SPA bootstraps
 * end-to-end. Previously skipped due to what was mis-identified as a
 * Playwright+Angular-zoneless flake on Windows; the actual root cause was a
 * route-ordering bug (`path: ''` with `{ path: '**' }` child eating every
 * URL before `/auth` could match), fixed in the Phase-23 route reorder.
 */
test('login page renders without auth', async ({ page }) => {
  await page.goto('/auth/login', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
  await expect(page.getByText('Merchant Engine').first()).toBeVisible();
});
