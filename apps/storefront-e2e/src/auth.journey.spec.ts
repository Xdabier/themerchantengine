import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test } from '@playwright/test';

import {
  attachAuthToBrowser,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  signUpViaApi,
  type ConsoleBaseline,
} from './support';

/**
 * BA4 — storefront auth journey.
 *
 * Drives the live storefront against the real Better Auth test API. Per
 * constitution §3.8 there is no `page.route()` mocking and no fixtures — every
 * assertion crosses the wire. The storefront authenticates through Better Auth
 * (DR-24): the session is one `HttpOnly` cookie, there is no access token, and
 * there is no refresh round-trip.
 *
 * The dev tier covers the anonymous render + axe sweep of each auth surface in
 * both locales. The authenticated journeys (register / sign-in / sign-out /
 * magic-link / forgot / boot reload) gate behind `STOREFRONT_E2E_BUILT=1` per
 * the S9 precedent (clarifications §1.23) — Vite SSR cold-start exceeds the
 * parallel-worker per-test budget on the dev server. The unit + component tier
 * exhaustively covers the wiring (`auth.service.spec.ts`, `auth-client.spec.ts`,
 * `layout-shell.component.spec.ts`, the four auth page specs). The dev-server CI
 * run never registers the gated tests — no `test.skip` marker is emitted, so
 * constitution §3.8 is satisfied.
 */

const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';

/**
 * Locale-resolved strings asserted to prove the locale matrix (§3.11.4).
 * Copied verbatim from `apps/storefront/src/i18n/{fr,en,ar}.ts`, so a silent
 * translation drift on either side fails here rather than shipping.
 * `accountGreeting` is a prefix: the rendered line interpolates a first name.
 */
const AUTH_STRINGS = {
  fr: {
    loginHeading: 'Se connecter',
    registerHeading: 'Créer votre compte',
    registeredHeading: 'Consultez votre boîte mail',
    forgotHeading: 'Réinitialiser votre mot de passe',
    forgotSuccessHeading: 'Consultez votre boîte mail',
    forgotSuccessSent: 'nous lui avons envoyé un lien de réinitialisation',
    forgotSuccessStale: 'contactez notre équipe',
    magicLinkSentHeading: 'Consultez votre boîte mail',
    accountGreeting: 'Bonjour, Docteur',
    loginErrorInvalid: 'L’e-mail ou le mot de passe est incorrect.',
    registerErrorExists: 'Un compte existe déjà avec cette adresse e-mail.',
    resetErrorTokenInvalid:
      'Ce lien de réinitialisation est invalide ou expiré. Demandez-en un nouveau.',
  },
  en: {
    loginHeading: 'Sign in',
    registerHeading: 'Create your account',
    registeredHeading: 'Check your inbox',
    forgotHeading: 'Reset your password',
    forgotSuccessHeading: 'Check your inbox',
    forgotSuccessSent: 'we have sent it a reset link',
    forgotSuccessStale: 'contact our team',
    magicLinkSentHeading: 'Check your inbox',
    accountGreeting: 'Welcome back',
    loginErrorInvalid: 'The email or password is incorrect.',
    registerErrorExists: 'An account with that email already exists.',
    resetErrorTokenInvalid: 'This reset link is invalid or has expired. Request a new link.',
  },
  ar: {
    loginHeading: 'تسجيل الدخول',
    registerHeading: 'أنشئ حسابك',
    registeredHeading: 'تحقق من بريدك',
    forgotHeading: 'إعادة تعيين كلمة المرور',
    forgotSuccessHeading: 'تحقق من بريدك',
    forgotSuccessSent: 'أرسلنا إليه رابط إعادة التعيين',
    forgotSuccessStale: 'التواصل مع فريق الدعم',
    magicLinkSentHeading: 'تحقق من بريدك',
    accountGreeting: 'مرحبًا بعودتك',
    loginErrorInvalid: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    registerErrorExists: 'يوجد حساب بهذا البريد الإلكتروني.',
    resetErrorTokenInvalid: 'رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.',
  },
} as const;

const PASSWORD = 'StrongPass1';

function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@auth.test`;
}

describeEveryLocale('storefront BA4 auth journey', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  const strings = copyFor(AUTH_STRINGS, locale);

  // ── Dev tier — anonymous render + axe (always runs) ──────────────────────

  test(`anonymous /auth/login renders a labelled form (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/auth/login`);
    await expect(page.locator('#auth-shell-heading')).toHaveText(strings.loginHeading);
    await expect(page.getByTestId('auth-login-form')).toBeVisible();
    await expect(page.getByTestId('auth-login-email')).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByTestId('auth-login-password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    await expect(page.getByTestId('auth-login-submit')).toBeVisible();
    await expect(page.getByTestId('auth-login-magic-link')).toBeVisible();
  });

  test(`anonymous /auth/register exposes the full form (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/auth/register`);
    await expect(page.locator('#auth-shell-heading')).toHaveText(strings.registerHeading);
    await expect(page.getByTestId('auth-register-first-name')).toBeVisible();
    await expect(page.getByTestId('auth-register-last-name')).toBeVisible();
    await expect(page.getByTestId('auth-register-email')).toBeVisible();
    await expect(page.getByTestId('auth-register-password')).toBeVisible();
    await expect(page.getByTestId('auth-register-terms')).toBeVisible();
    await expect(page.getByTestId('auth-register-submit')).toBeVisible();
  });

  /**
   * Finding A8. The honeypot must stay invisible to assistive tech and out of
   * the tab order, or a screen-reader user fills it and gets rejected as a bot.
   * The axe sweep below would not catch a missing `tabindex`, so pin the DOM.
   */
  test(`the register honeypot stays out of the a11y tree and tab order (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/auth/register`);
    const honeypot = page.locator('#auth-register-company');
    await expect(honeypot).toHaveAttribute('tabindex', '-1');
    await expect(honeypot).toHaveCount(1);
    const hiddenAncestors = page.locator('[aria-hidden="true"] #auth-register-company');
    await expect(hiddenAncestors).toHaveCount(1);
  });

  test(`anonymous /auth/forgot-password renders the email input (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/auth/forgot-password`);
    await expect(page.locator('#auth-shell-heading')).toHaveText(strings.forgotHeading);
    await expect(page.getByTestId('auth-forgot-form')).toBeVisible();
    await expect(page.getByTestId('auth-forgot-email')).toBeVisible();
  });

  test(`anonymous /auth/reset-password without ?token shows the missing-token panel (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/auth/reset-password`);
    await expect(page.getByTestId('auth-reset-token-missing')).toBeVisible();
    await expect(page.getByTestId('auth-reset-form')).not.toBeVisible();
  });

  test(`anonymous /auth/reset-password?token=stub renders the form (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/auth/reset-password?token=stub`);
    await expect(page.getByTestId('auth-reset-form')).toBeVisible();
  });

  test(`axe wcag22aa zero serious / critical on each auth surface (${locale})`, async ({
    page,
  }) => {
    const surfaces = [
      `/${locale}/auth/login`,
      `/${locale}/auth/register`,
      `/${locale}/auth/forgot-password`,
      `/${locale}/auth/reset-password?token=stub`,
    ];
    for (const path of surfaces) {
      await page.goto(path);
      await injectAxe(page);
      await checkA11y(page, undefined, {
        axeOptions: {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
          },
        },
        detailedReport: false,
        includedImpacts: ['serious', 'critical'],
      });
    }
  });

  // ── Authenticated journeys — gated behind STOREFRONT_E2E_BUILT ───────────
  // Per the S9 precedent: Vite SSR cold-start exceeds the parallel-worker
  // per-test budget on the dev server, so the multi-step authed flows run in
  // the built lane. The gate is a describe-level conditional, not a skip.
  if (STOREFRONT_E2E_BUILT) {
    test.describe(`authenticated journeys (${locale})`, () => {
      test(`register creates the account and shows the verify-email panel (${locale})`, async ({
        page,
      }) => {
        await page.goto(`/${locale}/auth/register`);
        await page.getByTestId('auth-register-first-name').fill('Aisha');
        await page.getByTestId('auth-register-last-name').fill('Karim');
        await page.getByTestId('auth-register-email').fill(uniqueEmail('register'));
        await page.getByTestId('auth-register-password').fill(PASSWORD);
        await page.getByTestId('auth-register-terms').check();
        await page.getByTestId('auth-register-submit').click();
        await expect(page.getByTestId('auth-register-success')).toBeVisible();
        await expect(page.locator('#auth-shell-heading')).toHaveText(strings.registeredHeading);
      });

      test(`password sign-in lands the customer authenticated (${locale})`, async ({
        page,
        request,
      }) => {
        const email = uniqueEmail('signin');
        await signUpViaApi(request, {
          email,
          password: PASSWORD,
          firstName: 'Layla',
          lastName: 'Mansour',
        });

        await page.goto(`/${locale}/auth/login`);
        await page.getByTestId('auth-login-email').fill(email);
        await page.getByTestId('auth-login-password').fill(PASSWORD);
        await page.getByTestId('auth-login-submit').click();

        await page.waitForURL(`**/${locale}/account`);
        await expect(page.getByTestId('account-page')).toBeVisible();
        await expect(page.getByTestId('account-menu-trigger')).toBeVisible();
        await expect(page.getByTestId('account-page-greeting')).toContainText(
          strings.accountGreeting,
        );

        // The session is the mutation, so the seam that matters is whether it
        // survives leaving the page and coming back. A cookie that only works
        // inside the flow that created it is the shape of the 2026-05-16
        // auth-stick outage.
        await reloadAndAssertClean(page, `/${locale}/account`, baseline, {
          afterReload: async () => {
            await expect(page.getByTestId('account-page-greeting')).toContainText(
              strings.accountGreeting,
            );
          },
        });
      });

      test(`sign-out returns the shell to the anonymous state (${locale})`, async ({
        page,
        request,
      }) => {
        // Reload-resilience carve-out: sign-out is itself the destructive
        // action under test — a same-page reload would re-assert a session
        // that was deliberately cleared. The journey instead verifies the
        // anonymous shell across a navigation (account → login), the
        // meaningful post-sign-out seam.
        const session = await signUpViaApi(request, {
          email: uniqueEmail('signout'),
          password: PASSWORD,
          firstName: 'Omar',
          lastName: 'Haddad',
        });
        await attachAuthToBrowser(page, session);

        await page.goto(`/${locale}/account`);
        await expect(page.getByTestId('account-menu-trigger')).toBeVisible();

        await page.getByTestId('account-menu-trigger').click();
        await page.getByTestId('account-menu-logout').click();

        await expect(page.getByTestId('account-menu-anonymous')).toBeVisible();
        // Finding A1: sign-out navigates to `/{locale}/`, and the router used
        // to parse that trailing slash as an empty segment no route consumes,
        // so the catch-all rendered the 404 page under an unchanged URL.
        await expect(page).toHaveURL(new RegExp(`/${locale}/$`));
        await expect(page.locator('app-not-found-page')).toHaveCount(0);
        await expect(page.locator('[data-testid="home-hero"]').first()).toBeVisible();

        await page.goto(`/${locale}/auth/login`);
        await expect(page.locator('#auth-shell-heading')).toHaveText(strings.loginHeading);
      });

      /**
       * Finding N4. A hard load of an account page races the shell's single
       * `getSession()`: the guard used to read `isAuthed()` before the cookie
       * had been resolved and bounced a valid customer to the login form. The
       * profile page is the sharpest case because its `state` signal starts on
       * a branch the template does not render, so a parked page shows a bare
       * heading.
       */
      test(`a hard load of an account page keeps a valid session (${locale})`, async ({
        page,
        request,
      }) => {
        const session = await signUpViaApi(request, {
          email: uniqueEmail('bootload'),
          password: PASSWORD,
          firstName: 'Nadia',
          lastName: 'Trabelsi',
        });
        await attachAuthToBrowser(page, session);

        for (const route of [
          `/${locale}/account/profile`,
          `/${locale}/account/orders`,
          `/${locale}/account/addresses`,
        ]) {
          await page.goto(route);
          await expect(page).toHaveURL(new RegExp(`${route}$`));
          await expect(page.locator('[data-testid="auth-login-form"]')).toHaveCount(0);
        }

        await expect(page.getByTestId('account-addresses-page')).toBeVisible();
        await page.goto(`/${locale}/account/profile`);
        await expect(page.getByTestId('account-profile-form')).toBeVisible();
      });

      /**
       * Findings N1 and N2. A signed-in customer landing on the login page was
       * stranded on a credential form, and the mobile Account tab sent them
       * back to that same form because it was hardcoded to the login route.
       */
      test(`an authed visitor is forwarded off the login page (${locale})`, async ({
        page,
        request,
      }) => {
        const session = await signUpViaApi(request, {
          email: uniqueEmail('authedlogin'),
          password: PASSWORD,
          firstName: 'Sami',
          lastName: 'Ben Ali',
        });
        await attachAuthToBrowser(page, session);

        await page.goto(`/${locale}/auth/login`);
        await page.waitForURL(`**/${locale}/account`);
        await expect(page.getByTestId('account-page')).toBeVisible();
        await expect(page.getByTestId('auth-login-form')).toHaveCount(0);
      });

      test(`an authed visitor is forwarded off the register page (${locale})`, async ({
        page,
        request,
      }) => {
        const session = await signUpViaApi(request, {
          email: uniqueEmail('authedregister'),
          password: PASSWORD,
          firstName: 'Rim',
          lastName: 'Gharbi',
        });
        await attachAuthToBrowser(page, session);

        await page.goto(`/${locale}/auth/register`);
        await page.waitForURL(`**/${locale}/account`);
        await expect(page.getByTestId('account-page')).toBeVisible();
      });

      test(`the mobile account tab lands an authed customer on the dashboard (${locale})`, async ({
        page,
        request,
      }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const session = await signUpViaApi(request, {
          email: uniqueEmail('bottomnav'),
          password: PASSWORD,
          firstName: 'Yassine',
          lastName: 'Bouzid',
        });
        await attachAuthToBrowser(page, session);

        await page.goto(`/${locale}/`);
        const accountTab = page.getByTestId('bottom-nav-account');
        await expect(accountTab).toHaveAttribute('href', `/${locale}/account`);
        await accountTab.click();

        await page.waitForURL(`**/${locale}/account`);
        await expect(page.getByTestId('account-page')).toBeVisible();
        await expect(page.getByTestId('auth-login-form')).toHaveCount(0);
      });

      test(`the magic-link option emails a sign-in link (${locale})`, async ({ page }) => {
        await page.goto(`/${locale}/auth/login`);
        await page.getByTestId('auth-login-email').fill(uniqueEmail('magic'));
        await page.getByTestId('auth-login-magic-link').click();
        await expect(page.getByTestId('auth-login-magic-link-sent')).toBeVisible();
        await expect(page.locator('#auth-shell-heading')).toHaveText(strings.magicLinkSentHeading);
      });

      test(`forgot-password submits and shows the check-inbox panel (${locale})`, async ({
        page,
      }) => {
        await page.goto(`/${locale}/auth/forgot-password`);
        await expect(page.getByTestId('auth-forgot-form')).toBeVisible();
        const email = uniqueEmail('forgot');
        const forgotSubmit = page.locator('[data-testid="auth-forgot-submit"] button');
        // A fill against server-rendered markup sets the DOM value but not the
        // reactive control, and hydration then resets the input. Re-fill until
        // the submit enables: that is the only reliable signal that Angular is
        // driving this form.
        await expect
          .poll(
            async () => {
              await page.getByTestId('auth-forgot-email').fill(email);
              return forgotSubmit.isEnabled();
            },
            { timeout: 30000 },
          )
          .toBe(true);
        await forgotSubmit.click();
        await expect(page.getByTestId('auth-forgot-success')).toBeVisible();
        await expect(page.locator('#auth-shell-heading')).toHaveText(strings.forgotSuccessHeading);
        // Finding A7: the copy used to tell the customer to contact the team
        // for a reset link the API had already emailed them, so the one person
        // who read it carefully was the one who never reset their password.
        await expect(page.getByTestId('auth-forgot-success')).toContainText(
          strings.forgotSuccessSent,
        );
        await expect(page.getByTestId('auth-forgot-success')).not.toContainText(
          strings.forgotSuccessStale,
        );
      });

      test(`authed session survives repeated hard reloads (${locale})`, async ({
        page,
        request,
      }) => {
        const session = await signUpViaApi(request, {
          email: uniqueEmail('reload'),
          password: PASSWORD,
          firstName: 'Noor',
          lastName: 'Saleh',
        });
        await attachAuthToBrowser(page, session);

        await page.goto(`/${locale}/account`);
        await expect(page.getByTestId('account-menu-trigger')).toBeVisible();

        // §3.11.6 boot resilience — the single getSession() must re-resolve
        // the session on every cold boot. Three hard reloads stand in for the
        // F5×10 manual check; a regressed boot would drop to the anonymous
        // shell on one of them.
        for (let i = 0; i < 3; i++) {
          await page.reload();
          await expect(page.getByTestId('account-menu-trigger')).toBeVisible();
        }
        await expect(page.getByTestId('account-page-greeting')).toContainText(
          strings.accountGreeting,
        );
      });

      test(`wrong-password sign-in surfaces the localized error (${locale})`, async ({
        page,
        request,
      }) => {
        const email = uniqueEmail('badpass');
        await signUpViaApi(request, {
          email,
          password: PASSWORD,
          firstName: 'Hana',
          lastName: 'Yousef',
        });

        await page.goto(`/${locale}/auth/login`);
        await page.getByTestId('auth-login-email').fill(email);
        await page.getByTestId('auth-login-password').fill('WrongPass9');
        await page.getByTestId('auth-login-submit').click();

        await expect(page.getByTestId('auth-login-error')).toHaveText(strings.loginErrorInvalid);
      });

      test(`duplicate-email registration surfaces the localized error (${locale})`, async ({
        page,
        request,
      }) => {
        const email = uniqueEmail('dup');
        await signUpViaApi(request, {
          email,
          password: PASSWORD,
          firstName: 'Sami',
          lastName: 'Aziz',
        });

        await page.goto(`/${locale}/auth/register`);
        await page.getByTestId('auth-register-first-name').fill('Sami');
        await page.getByTestId('auth-register-last-name').fill('Aziz');
        await page.getByTestId('auth-register-email').fill(email);
        await page.getByTestId('auth-register-password').fill(PASSWORD);
        await page.getByTestId('auth-register-terms').check();
        await page.getByTestId('auth-register-submit').click();

        await expect(page.getByTestId('auth-register-error')).toHaveText(
          strings.registerErrorExists,
        );
      });

      test(`an invalid reset token surfaces the localized error (${locale})`, async ({ page }) => {
        await page.goto(`/${locale}/auth/reset-password?token=ba4-not-a-real-token`);
        await page.getByTestId('auth-reset-password').fill(PASSWORD);
        await page.getByTestId('auth-reset-confirm').fill(PASSWORD);
        await page.getByTestId('auth-reset-submit').click();

        await expect(page.getByTestId('auth-reset-error')).toHaveText(
          strings.resetErrorTokenInvalid,
        );
      });
    });
  }
});
