import { expect, test } from '@playwright/test';

import {
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  type ConsoleBaseline,
} from './support';

/**
 * NE9 — storefront newsletter signup + double-opt-in confirmation.
 *
 * Anonymous flows against the live test API at 53001 (no page.route, no
 * fixtures). The footer signup render + the confirm landing page run ungated
 * (SSR shell); the form-submit path gates behind STOREFRONT_E2E_BUILT because a
 * Reactive Form submit needs hydration (matches the NE7 precedent).
 */
const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';

// Copied verbatim from `newsletter-signup.component.ts` and
// `[locale]/newsletter/confirm.page.ts`, so a copy drift on either locale
// fails here instead of shipping.
const HEADING = { en: 'Newsletter', fr: 'Lettre d’information', ar: 'النشرة البريدية' } as const;
const CONFIRMED = {
  en: 'Subscription confirmed',
  fr: 'Inscription confirmée',
  ar: 'تم تأكيد الاشتراك',
} as const;
const INVALID = { en: 'Link expired', fr: 'Lien expiré', ar: 'انتهت صلاحية الرابط' } as const;
const INVALID_MSG = {
  en: 'Enter a valid email address.',
  fr: 'Saisissez une adresse e-mail valide.',
  ar: 'أدخل بريدًا إلكترونيًا صالحًا.',
} as const;

describeEveryLocale('storefront NE9 newsletter', (locale) => {
  let baseline: ConsoleBaseline;

  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`footer signup renders the localized heading (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const signup = page.getByTestId('newsletter-signup');
    await expect(signup).toBeVisible();
    await expect(signup).toContainText(copyFor(HEADING, locale));
    await expect(page.getByTestId('newsletter-email')).toBeVisible();
  });

  test(`confirm page shows the localized confirmed state (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/newsletter/confirm?status=confirmed`);
    await expect(page.getByTestId('newsletter-confirm-page')).toBeVisible();
    await expect(page.getByTestId('newsletter-confirm-confirmed')).toContainText(
      copyFor(CONFIRMED, locale),
    );
  });

  test(`confirm page shows the localized invalid state (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/newsletter/confirm?status=invalid`);
    await expect(page.getByTestId('newsletter-confirm-invalid')).toContainText(
      copyFor(INVALID, locale),
    );
  });

  if (STOREFRONT_E2E_BUILT) {
    test(`subscribing shows the confirmation notice and stays clean across reload (${locale})`, async ({
      page,
    }) => {
      await page.goto(`/${locale}`);
      const email = `ne9-news-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`;
      await page.getByTestId('newsletter-email').fill(email);
      await page.getByTestId('newsletter-submit').click();
      await expect(page.getByTestId('newsletter-success')).toBeVisible();

      // Navigate away and back across the seam — no new console errors.
      await reloadAndAssertClean(page, `/${locale}`, baseline, {
        afterReload: async () => {
          await expect(page.getByTestId('newsletter-signup')).toBeVisible();
        },
      });
    });

    test(`an invalid email surfaces the localized validation message (${locale})`, async ({
      page,
    }) => {
      await page.goto(`/${locale}`);
      await page.getByTestId('newsletter-email').fill('not-an-email');
      await page.getByTestId('newsletter-submit').click();
      await expect(page.getByTestId('newsletter-invalid')).toContainText(
        copyFor(INVALID_MSG, locale),
      );
      await expect(page.getByTestId('newsletter-success')).toHaveCount(0);
    });
  }
});
