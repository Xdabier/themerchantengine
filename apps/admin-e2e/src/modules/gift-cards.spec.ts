import { test } from './_auth-fixture';
import { expectRoute, firstIdFromApi } from './_helpers';

test('gift cards list renders', async ({ page }) => {
  await expectRoute(page, '/gift-cards', 'gift-cards-list-page');
});

test('gift card issue form renders', async ({ page }) => {
  await expectRoute(page, '/gift-cards/issue', 'gift-card-issue-page');
});

test('gift card detail renders', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/gift-cards?pageSize=1');
  await expectRoute(page, `/gift-cards/${id}`, 'gift-card-detail-page');
});
