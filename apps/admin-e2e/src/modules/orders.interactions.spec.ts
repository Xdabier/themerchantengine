import { test, expect } from './_auth-fixture';
import { firstIdFromApi } from './_helpers';

test('orders list → filter by status → detail drill-in', async ({ page, baseURL }) => {
  await page.goto('/orders', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="orders-list-page"]')).toBeVisible();

  // Status filter chip group — clicking one should rescope the list.
  const shipped = page.getByRole('button', { name: 'Shipped', exact: true });
  await shipped.click();
  await expect(shipped).toHaveAttribute('aria-pressed', 'true');
  await page.waitForURL(/status=SHIPPED/);
  await page.screenshot({ path: '.e2e-review/orders-filter-shipped.png', fullPage: true });

  // Open the first order detail (use API to pick one independent of list rendering).
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/orders?pageSize=1');
  await page.goto(`/orders/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="order-detail-page"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/orders-detail.png', fullPage: true });
});
