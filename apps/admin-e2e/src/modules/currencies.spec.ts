import { test } from './_auth-fixture';
import { expectRoute } from './_helpers';

test('currencies page renders', async ({ page }) => {
  await expectRoute(page, '/currencies', 'currencies-page');
});
