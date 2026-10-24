import { test, expect } from './_auth-fixture';
import { firstIdFromApi } from './_helpers';

test('products list → filter by status → detail drill-in', async ({ page, baseURL }) => {
  await page.goto('/products', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="products-list-page"]')).toBeVisible();

  const activeFilter = page.getByRole('button', { name: 'Active', exact: true });
  await activeFilter.click();
  await expect(activeFilter).toHaveAttribute('aria-pressed', 'true');
  await page.waitForURL(/status=ACTIVE/);
  await page.screenshot({ path: '.e2e-review/products-filter-active.png', fullPage: true });

  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/products?pageSize=1');
  await page.goto(`/products/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-detail-page"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/products-detail.png', fullPage: true });

  // Edit mode unlocks the write form.
  await page.goto(`/products/${id}/edit`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="product-edit-page"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/products-edit.png', fullPage: true });
});
