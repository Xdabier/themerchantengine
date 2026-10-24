// Canary fixture. Never collected by Playwright.
// hardening-waived: describeEveryLocale, reloadAndAssertClean. API-route
// journey with no rendered page, so there is no locale surface and no state to
// survive a reload.
import { test } from '@playwright/test';

import { attachConsoleBaseline } from './support';

test('conditional skip is a runtime guard, not a closed failure', async ({ page, request }) => {
  const baseline = attachConsoleBaseline(page);
  test.skip(process.env.STOREFRONT_E2E_BUILT !== '1', 'authed flow, built tier only');
  await request.post('/api/_internal/revalidate', { data: {} });
  baseline.assertClean();
});
