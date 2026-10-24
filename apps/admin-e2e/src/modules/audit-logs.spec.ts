import { test } from './_auth-fixture';
import { expectRoute } from './_helpers';

test('audit logs page renders', async ({ page }) => {
  await expectRoute(page, '/audit-logs', 'audit-logs-page');
});
