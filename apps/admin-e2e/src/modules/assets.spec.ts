import { test } from './_auth-fixture';
import { expectRoute, firstIdFromApi } from './_helpers';

test('assets library renders', async ({ page }) => {
  await expectRoute(page, '/assets', 'assets-library-page');
});

test('asset detail renders', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/assets?pageSize=1');
  await expectRoute(page, `/assets/${id}`, 'asset-detail-page');
});
