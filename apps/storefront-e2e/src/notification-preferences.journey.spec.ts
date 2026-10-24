import { expect, test } from '@playwright/test';

import {
  attachAuthToBrowser,
  attachConsoleBaseline,
  authCookieHeader,
  describeEveryLocale,
  reloadAndAssertClean,
  signUpViaApi,
  STOREFRONT_API_BASE,
  type ConsoleBaseline,
} from './support';

/**
 * NE7 — customer notification preference center.
 *
 * Drives the live storefront against the real test API at 53001. Per
 * constitution §3.8: no `page.route()` mocking, no fixtures. The authed
 * mutation flow gates behind STOREFRONT_E2E_BUILT (Vite SSR cold-start exceeds
 * the dev-tier worker budget), matching the S11 account-journey precedent. The
 * anonymous SSR shell + axe + login-redirect for `/account/preferences` are
 * covered by `account.journey.spec.ts` (route added to its matrix).
 */

const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';

describeEveryLocale('storefront NE7 notification preferences', (locale) => {
  let baseline: ConsoleBaseline;

  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  if (STOREFRONT_E2E_BUILT) {
    test(`authed customer opts into a category and it persists across reload (${locale})`, async ({
      page,
      request,
    }) => {
      const email = `ne7-pref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`;
      const auth = await signUpViaApi(request, {
        email,
        password: 'Fixture-Test-123!',
        firstName: 'Pref',
        lastName: 'Tester',
      });
      await attachAuthToBrowser(page, auth);

      await page.goto(`/${locale}/account/preferences`);

      const toggle = page.getByTestId('pref-toggle-LIFECYCLE');
      await expect(toggle).toBeVisible();
      // Opt-in default: a brand-new customer starts opted out.
      await expect(toggle).not.toBeChecked();

      await toggle.check();
      await page.getByTestId('account-preferences-form-submit').click();
      await expect(page.getByTestId('account-preferences-status')).toBeVisible();

      // Persist across a navigate-away-and-return seam (no new console errors).
      await reloadAndAssertClean(page, `/${locale}/account/preferences`, baseline, {
        afterReload: async () => {
          await expect(page.getByTestId('pref-toggle-LIFECYCLE')).toBeChecked();
        },
      });

      // The API reflects the opt-in.
      const apiRes = await request.get(
        `${STOREFRONT_API_BASE}/v1/users/me/notification-preferences`,
        { headers: { Cookie: authCookieHeader(auth), 'Accept-Language': locale } },
      );
      expect(apiRes.status()).toBe(200);
      expect((await apiRes.json()).data.LIFECYCLE.email).toBe(true);
    });
  }
});
