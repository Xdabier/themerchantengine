import { test, expect } from './_auth-fixture';
import { firstIdFromApi } from './_helpers';

test('gift cards list → detail drill-in', async ({ page, baseURL }) => {
  await page.goto('/gift-cards', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="gift-cards-list-page"]')).toBeVisible();

  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/gift-cards?pageSize=1');
  await page.goto(`/gift-cards/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="gift-card-detail-page"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/gift-cards-detail.png', fullPage: true });
});

test('gift cards issue form renders required inputs', async ({ page }) => {
  await page.goto('/gift-cards/issue', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="gift-card-issue-page"]')).toBeVisible();
  // Form fields by id — more stable than label-matching because app-input
  // wraps the native input in a CVA that doesn't always get picked up by
  // Playwright's accessibility-tree label resolver.
  // The shared InputComponent duplicates the id onto the host element, so
  // `#gc-amount` matches two nodes. Constrain to the native <input>.
  await expect(page.locator('input#gc-amount')).toBeVisible();
  // Currency is a select over the store's enabled currencies, not free text.
  await expect(page.locator('select#gc-currency')).toBeVisible();
  await expect(page.locator('input#gc-email')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/gift-cards-issue-form.png', fullPage: true });
});
