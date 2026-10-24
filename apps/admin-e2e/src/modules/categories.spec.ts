import { test } from './_auth-fixture';
import { expectRoute, firstIdFromApi } from './_helpers';

test('categories tree renders', async ({ page }) => {
  await expectRoute(page, '/categories', 'categories-tree-page');
});

test('new category form renders', async ({ page }) => {
  await expectRoute(page, '/categories/new', 'category-form-page');
});

test('existing category form renders', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/categories?pageSize=1');
  await expectRoute(page, `/categories/${id}`, 'category-form-page');
});
