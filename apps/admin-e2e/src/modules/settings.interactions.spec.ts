import { test, expect } from './_auth-fixture';

test('settings home navigates to each sub-page', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="settings-home-page"]')).toBeVisible();

  for (const { label, testid } of [
    { label: 'General', testid: 'settings-general-page' },
    { label: 'Locales', testid: 'settings-locales-page' },
    { label: 'Appearance', testid: 'settings-appearance-page' },
    { label: 'Integrations', testid: 'settings-integrations-page' },
  ]) {
    await page.goto('/settings', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: label }).first().click();
    await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible();
    await page.screenshot({
      path: `.e2e-review/settings-flow-${label.toLowerCase()}.png`,
      fullPage: true,
    });
  }
});
