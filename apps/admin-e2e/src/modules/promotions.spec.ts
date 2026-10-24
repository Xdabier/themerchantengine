import { test } from './_auth-fixture';
import { expectRoute, firstIdFromApi } from './_helpers';

test('promotions list renders', async ({ page }) => {
  await expectRoute(page, '/promotions', 'promotions-list-page');
});

test('promotion detail renders', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/promotions?pageSize=1');
  await expectRoute(page, `/promotions/${id}`, 'promotion-detail-page');
});
