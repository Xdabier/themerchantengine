import { test } from './_auth-fixture';
import { expectRoute, firstIdFromApi } from './_helpers';

test('orders list renders', async ({ page }) => {
  await expectRoute(page, '/orders', 'orders-list-page');
});

test('orders detail renders', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/orders?pageSize=1');
  await expectRoute(page, `/orders/${id}`, 'order-detail-page');
});
