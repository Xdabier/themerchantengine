import { test, expect } from '@playwright/test';

/**
 * Design-system showcase e2e. Validates that every primitive section renders
 * + remains brand-compliant (zero radius enforced by the global reset).
 *
 * Previously skipped due to the misdiagnosed "Playwright+Angular zoneless
 * flake"; actual root cause was the `path: ''` wildcard catch-all swallowing
 * `/auth/login` + all other routes (authGuard redirect loop). Fixed in the
 * Phase-23 route reorder.
 */
test('design-system page renders every primitive section', async ({ page }) => {
  await page.goto('/dev/design-system', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="design-system-page"]')).toBeVisible();

  for (const testid of [
    'demo-buttons',
    'demo-forms',
    'demo-badges',
    'demo-loading',
    'demo-typography',
    'demo-links',
    'demo-icon',
    'demo-kpi',
    'demo-tabstrip',
    'demo-translatable',
    'demo-richtext',
    'demo-dropzone',
    'demo-dialog',
  ]) {
    await expect(page.locator(`section[data-testid="${testid}"]`)).toBeVisible();
  }
});

test('zero-radius reset holds on interactive elements', async ({ page }) => {
  await page.goto('/dev/design-system', { waitUntil: 'networkidle' });
  const radii = await page.$$eval('button, input, textarea', (els) =>
    els.map((el) => getComputedStyle(el).borderRadius),
  );
  for (const r of radii) {
    expect(r).toBe('0px');
  }
});
