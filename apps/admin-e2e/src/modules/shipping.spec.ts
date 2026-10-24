import { test } from './_auth-fixture';
import { expectRoute, firstIdFromApi } from './_helpers';

test('carriers list renders', async ({ page }) => {
  await expectRoute(page, '/shipping/carriers', 'carriers-list-page');
});

test('countries page renders', async ({ page }) => {
  await expectRoute(page, '/shipping/countries', 'countries-page');
});

test('tax zones list renders', async ({ page }) => {
  await expectRoute(page, '/shipping/tax', 'tax-zones-list-page');
});

test('tax zone editor renders', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/tax/zones?pageSize=1');
  await expectRoute(page, `/shipping/tax/${id}`, 'tax-zone-editor-page');
});
