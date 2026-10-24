import { test } from './_auth-fixture';
import { expectRoute } from './_helpers';

test('me page renders', async ({ page }) => {
  await expectRoute(page, '/me', 'me-page');
});
