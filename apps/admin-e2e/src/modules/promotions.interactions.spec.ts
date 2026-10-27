import { test, expect } from './_auth-fixture';
import { firstIdFromApi } from './_helpers';

test('promotions list → live filter → detail drill-in', async ({ page, baseURL }) => {
  await page.goto('/promotions', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="promotions-list-page"]')).toBeVisible();

  const live = page.getByRole('button', { name: 'Live', exact: true });
  await live.click();
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '.e2e-review/promotions-filter-live.png', fullPage: true });

  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/promotions?pageSize=1');
  await page.goto(`/promotions/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="promotion-detail-page"]')).toBeVisible();
  await page.screenshot({ path: '.e2e-review/promotions-detail.png', fullPage: true });
});
