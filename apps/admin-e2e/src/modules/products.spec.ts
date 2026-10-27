import { test } from './_auth-fixture';
import { expectRoute, firstIdFromApi } from './_helpers';

test('products list renders', async ({ page }) => {
  await expectRoute(page, '/products', 'products-list-page');
});

test('product detail renders', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/products?pageSize=1');
  await expectRoute(page, `/products/${id}`, 'product-detail-page');
});

test('product edit renders', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/products?pageSize=1');
  await expectRoute(page, `/products/${id}/edit`, 'product-edit-page');
});
