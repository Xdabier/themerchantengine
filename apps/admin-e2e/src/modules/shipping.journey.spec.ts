import { test, expect } from './_auth-fixture';
import { firstIdFromApi } from './_helpers';

/**
 * Phase 24.5 — shipping (carriers) + tax zone write journeys.
 *
 * Journeys cover the three UI-only flows that change persisted state:
 *   1. Edit a carrier's `sortOrder`, persist via /api/v1/admin/shipping/carriers/:id
 *   2. Toggle a carrier's `isActive` checkbox + save
 *   3. Edit a tax zone's rate + persist via /api/v1/admin/tax/zones/:id
 *
 * Admin does NOT yet expose a dedicated inventory screen (stock is managed
 * inline via product-variant dialogs — covered in Phase 24.2 products
 * journey). Nothing to exercise here for "inventory".
 */

test('carrier-detail: edit sort order → persist across reload', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/carriers?pageSize=1');
  await page.goto(`/shipping/carriers/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="carrier-detail-page"]')).toBeVisible();

  const sortInput = page.locator('input#car-sort');
  const newSort = `${Math.floor(Math.random() * 89) + 10}`;
  await sortInput.fill(newSort);

  await page.locator('[data-testid="car-save"]').click();
  await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 10_000 });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input#car-sort')).toHaveValue(newSort);
  await page.screenshot({ path: '.e2e-review/journey-carrier-sort-saved.png', fullPage: true });
});

test('carrier-detail: toggle active → persist across reload', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/carriers?pageSize=1');
  await page.goto(`/shipping/carriers/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="carrier-detail-page"]')).toBeVisible();

  const activeToggle = page.locator('[data-testid="car-active"]');
  const before = await activeToggle.isChecked();

  await activeToggle.click();
  await expect(activeToggle).toBeChecked({ checked: !before });

  await page.locator('[data-testid="car-save"]').click();
  await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 10_000 });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="car-active"]')).toBeChecked({ checked: !before });
  await page.screenshot({ path: '.e2e-review/journey-carrier-active-toggled.png', fullPage: true });

  // Revert so subsequent runs stay deterministic for other specs that might
  // care about the seeded carrier's default-active state.
  await page.locator('[data-testid="car-active"]').click();
  await page.locator('[data-testid="car-save"]').click();
  await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 10_000 });
});

test('tax-zone-editor: adjust rate → persist across reload', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/tax/zones?pageSize=1');
  await page.goto(`/shipping/tax/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tax-zone-editor-page"]')).toBeVisible();

  const rateInput = page.locator('input#tax-rate');
  const newRate = `${(Math.random() * 9 + 1).toFixed(2)}`;
  await rateInput.fill(newRate);

  await page.locator('[data-testid="tax-save"]').click();
  // Use exact match to avoid matching "Unsaved changes" footer text.
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  await page.reload({ waitUntil: 'networkidle' });
  // Numeric display may collapse trailing zeros (5.00 → 5); tolerate both.
  const displayed = await page.locator('input#tax-rate').inputValue();
  expect(Number(displayed)).toBeCloseTo(Number(newRate), 2);
  await page.screenshot({ path: '.e2e-review/journey-tax-rate-saved.png', fullPage: true });
});
