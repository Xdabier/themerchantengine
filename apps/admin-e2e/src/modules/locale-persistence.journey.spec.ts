import { test, expect } from './_auth-fixture';
import { request } from '@playwright/test';
import { checkA11y, injectAxe } from 'axe-playwright';
import { getAdminCookies } from './_helpers';

/**
 * R6.16 — Locale picker persistence journey.
 *
 * The /me page PATCHes /v1/users/me with the new locale and mirrors the
 * value into AuthStore via `setLocale()` so the next outbound request
 * carries the updated Accept-Language header. After a reload the value
 * must still come back as the persisted locale.
 *
 * Each run flips to `en`, asserts round-trip, then flips back to `fr`
 * so subsequent runs start clean.
 */

test.describe.configure({ mode: 'serial' });

async function resetLocale(baseURL: string, locale: string): Promise<void> {
  const cookies = getAdminCookies(baseURL);
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.patch('/api/v1/users/me', {
    headers: { Cookie: cookies },
    data: { locale },
  });
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(
      `[locale-persistence.journey] reset locale -> ${locale} failed: ${res.status()}`,
    );
  }
}

test('locale change on /me persists across reload and axe-clean', async ({ page, baseURL }) => {
  await resetLocale(baseURL!, 'fr');
  try {
    await page.goto('/me', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid="me-page"]')).toBeVisible({ timeout: 10_000 });

    const select = page.locator('[data-testid="me-locale-select"]');
    await expect(select).toHaveValue('fr');

    await select.selectOption('en');
    await page.locator('[data-testid="me-save"]').click();
    await expect(page.locator('[data-testid="me-notice"]')).toContainText(/updated/i, {
      timeout: 10_000,
    });

    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.locator('[data-testid="me-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="me-locale-select"]')).toHaveValue('en');

    await injectAxe(page);
    await checkA11y(page, undefined, { detailedReport: true });
  } finally {
    await resetLocale(baseURL!, 'fr');
  }
});
