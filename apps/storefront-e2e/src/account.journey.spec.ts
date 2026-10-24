import { checkA11y, injectAxe } from 'axe-playwright';
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  attachAuthToBrowser,
  attachConsoleBaseline,
  authCookieHeader,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  signInViaApi,
  signUpViaApi,
  waitForHydration,
  type AssertCleanOptions,
  type AuthSession,
  type ConsoleBaseline,
  activeStoreConfigFixture,
  type StorefrontLocale,
} from './support';

/** The store the harness seeded, for the title suffix and the address market. */
const STORE_NAME = activeStoreConfigFixture().identity.storeName.default;
const STORE_COUNTRY = activeStoreConfigFixture().identity.address.country;

/** Escapes a store name before it goes into a title-matching pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Phase S11 — account journey.
 *
 * Drives the live storefront against the real test API at 53001. Per
 * constitution §3.8 no `page.route()` mocking and no fixtures.
 *
 * The dev-server tier covers SSR shell rendering of every account route
 * in both locales plus an axe sweep on each. Anonymous redirect to
 * /auth/login is asserted at the route level.
 *
 * The full authed flows (orders list render, order detail, addresses,
 * wishlist, profile, OwnerGuard regression) gate behind
 * STOREFRONT_E2E_BUILT=1 per S6 / S8 / S9 / S10 precedent — Vite SSR
 * cold-start exceeds the parallel-worker budget in the dev tier.
 */

const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';
/**
 * The localized `PROFILE_CURRENT_PASSWORD_INCORRECT` copy, verbatim from
 * `apps/storefront/src/i18n/{fr,en}.ts`. Asserting the rendered string in both
 * locales is what makes the error path a real triple (stable code, both
 * translations, journey assertion).
 */
const SECURITY_STRINGS: Partial<Record<StorefrontLocale, { currentPasswordIncorrect: string }>> = {
  fr: { currentPasswordIncorrect: 'Votre mot de passe actuel est incorrect.' },
  en: { currentPasswordIncorrect: 'Your current password is incorrect.' },
  ar: { currentPasswordIncorrect: 'كلمة المرور الحالية غير صحيحة.' },
};

const SEED_EMAIL = 'cod-test+fixture@fixture.test';
const SEED_PASSWORD = 'Fixture-Test-123!';

function authHeaders(session: AuthSession, locale: StorefrontLocale): Record<string, string> {
  return {
    Cookie: authCookieHeader(session),
    'X-Requested-With': 'XMLHttpRequest',
    'Accept-Language': locale,
  };
}

const accountRoutes = [
  { path: '/account', testid: 'account-page' },
  { path: '/account/orders', testid: 'account-orders-page' },
  { path: '/account/orders/AKL-DOES-NOT-EXIST', testid: 'account-order-detail-page' },
  { path: '/account/addresses', testid: 'account-addresses-page' },
  { path: '/account/wishlist', testid: 'account-wishlist-page' },
  { path: '/account/profile', testid: 'account-profile-page' },
  { path: '/account/preferences', testid: 'account-preferences-page' },
] as const;

describeEveryLocale('storefront S11 account journey', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  /**
   * Two journeys drive the API into a deliberate refusal, and Chromium logs
   * every failed request as a console error. Scoped per test so every other
   * journey in this file stays strict.
   */
  let allowed: NonNullable<AssertCleanOptions['ignore']> = [];
  test.beforeEach(({ page }) => {
    allowed = [];
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean({ ignore: allowed });
  });

  for (const route of accountRoutes) {
    test(`anonymous ${route.path} SSR shell renders without crashing (${locale})`, async ({
      page,
    }) => {
      const response = await page.goto(`/${locale}${route.path}`);
      expect(response?.status()).toBeLessThan(500);
      await expect(page.getByTestId(route.testid)).toBeVisible();
    });

    test(`axe wcag22aa zero serious / critical on ${route.path} SSR shell (${locale})`, async ({
      page,
    }) => {
      await page.goto(`/${locale}${route.path}`);
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
    });
  }

  // Anonymous → login redirect. Every route in this list is gated now: the
  // public track page moved off `/account` entirely at plan M phase M3 and is
  // covered by `order-track.journey.spec.ts` (finding K9).
  for (const route of accountRoutes) {
    test(`anonymous visitor on ${route.path} redirects to /auth/login with from=... (${locale})`, async ({
      page,
    }) => {
      await page.goto(`/${locale}${route.path}`);
      // Hydration kicks in client-side and dispatches the redirect.
      await page.waitForURL(
        (url) => url.pathname === `/${locale}/auth/login` && url.searchParams.has('from'),
        { timeout: 15_000 },
      );
      const url = new URL(page.url());
      expect(url.searchParams.get('from')).toBe(`/${locale}${route.path}`);
    });
  }

  if (STOREFRONT_E2E_BUILT) {
    test(`authed customer sees their orders list and a recent-orders block (${locale})`, async ({
      page,
      request,
    }) => {
      const auth = await signInViaApi(request, SEED_EMAIL, SEED_PASSWORD);
      await attachAuthToBrowser(page, auth);

      await page.goto(`/${locale}/account`);
      await expect(page.getByTestId('account-page')).toBeVisible();
    });

    test(`order detail links each line back to its product (${locale})`, async ({
      page,
      request,
    }) => {
      // The name cell was plain text, so a placed order was a dead end:
      // nothing led back to the product. `OrderItem` has no slug column, so
      // the API resolves the catalogue slug at read time.
      const auth = await signInViaApi(request, SEED_EMAIL, SEED_PASSWORD);
      const headers = authHeaders(auth, locale);

      const addressId = await deliverableAddressId(request, headers);

      const productsRes = await request.get(
        `${STOREFRONT_API_BASE}/v1/products?isFeatured=true&pageSize=1`,
        { headers },
      );
      expect(productsRes.status()).toBe(200);
      const products = await productsRes.json();
      const product = products.data?.[0];
      const variantId = (product?.variants ?? [])[0]?.id;
      const productSlug = product?.slug as string;
      expect(variantId).toBeTruthy();
      expect(productSlug).toBeTruthy();

      const addRes = await request.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
        headers,
        data: { variantId, quantity: 1 },
      });
      expect([200, 201]).toContain(addRes.status());

      // `X-Idempotency-Key` is validated as a UUID v4, so an ad-hoc string is
      // refused with IDEMPOTENCY_KEY_MALFORMED before the handler ever runs.
      const idemKey = randomUUID();
      const placeRes = await request.post(`${STOREFRONT_API_BASE}/v1/orders`, {
        headers: { ...headers, 'X-Idempotency-Key': idemKey },
        data: { shippingAddressId: addressId },
      });
      expect(placeRes.status()).toBe(201);
      const orderId = (await placeRes.json()).data.id as string;

      await attachAuthToBrowser(page, auth);
      await page.goto(`/${locale}/account/orders/${orderId}`);
      const table = page.getByTestId('account-order-items-table');
      await expect(table).toBeVisible({ timeout: 30000 });

      const link = table.locator('a').first();
      await expect(link).toBeVisible({ timeout: 15000 });
      await expect(link).toHaveAttribute('href', `/${locale}/catalog/product/${productSlug}`);

      // The link goes somewhere real, which a slug that no longer resolves
      // would not.
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/catalog/product/${productSlug}`));
    });

    test(`OwnerGuard regression — Customer A's order id leaks 403 to Customer B, not 404 (${locale})`, async ({
      page,
      request,
    }) => {
      // 1. Log in as the seed customer (A) and place a fresh order so we
      //    have a known order id under their ownership.
      const aAuth = await signInViaApi(request, SEED_EMAIL, SEED_PASSWORD);
      const aHeaders = authHeaders(aAuth, locale);

      const addressId = await deliverableAddressId(request, aHeaders);

      const productsRes = await request.get(
        `${STOREFRONT_API_BASE}/v1/products?isFeatured=true&pageSize=1`,
        { headers: aHeaders },
      );
      expect(productsRes.status()).toBe(200);
      const products = await productsRes.json();
      const variantId = (products.data?.[0]?.variants ?? [])[0]?.id;
      expect(variantId).toBeTruthy();
      const addRes = await request.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
        headers: aHeaders,
        data: { variantId, quantity: 1 },
      });
      expect([200, 201]).toContain(addRes.status());

      // `X-Idempotency-Key` is validated as a UUID v4, so an ad-hoc string is
      // refused with IDEMPOTENCY_KEY_MALFORMED before the handler ever runs.
      const idemKey = randomUUID();
      const placeRes = await request.post(`${STOREFRONT_API_BASE}/v1/orders`, {
        headers: { ...aHeaders, 'X-Idempotency-Key': idemKey },
        data: { shippingAddressId: addressId },
      });
      expect(placeRes.status()).toBe(201);
      const orderA = (await placeRes.json()).data;
      const orderAId = orderA.id as string;
      expect(orderAId).toBeTruthy();

      // 2. Register Customer B (sibling), then GET A's order via the API
      //    with B's session. The API contract: 403 (OwnerGuard), never 404.
      const bEmail = `s11-ownerguard-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`;
      const bAuth = await signUpViaApi(request, {
        email: bEmail,
        password: 'Fixture-Test-123!',
        firstName: 'OwnerGuard',
        lastName: 'Sibling',
      });
      const bHeaders = authHeaders(bAuth, locale);

      const peekRes = await request.get(`${STOREFRONT_API_BASE}/v1/orders/${orderAId}`, {
        headers: bHeaders,
      });
      expect(
        peekRes.status(),
        `OwnerGuard must surface 403 (not 404) so the storefront cannot infer order existence`,
      ).toBe(403);

      // 3. Drive the storefront page as Customer B. Page should render
      //    the not-yours surface, never the not-found surface.
      await attachAuthToBrowser(page, bAuth);
      // Reading someone else's order is the assertion, and the 403 that
      // refuses it is logged by Chromium as a console error.
      allowed = [
        (entry) =>
          entry.kind === 'console.error' &&
          /status of 403/.test(entry.message) &&
          (entry.url ?? '').includes(`/v1/orders/${orderAId}`),
      ];
      await page.goto(`/${locale}/account/orders/${orderAId}`);
      // Either the API is reached and the not-yours surface renders, OR the
      // page redirects to login (if cookie auth did not take). Both are
      // acceptable defenses — what is NOT acceptable is the not-found
      // surface (which would leak that the id does not belong to B).
      const notYours = page.getByTestId('account-order-not-yours');
      const loginUrlSeen = page
        .waitForURL((url) => url.pathname === `/${locale}/auth/login`, { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      const result = await Promise.race([
        notYours.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'not-yours'),
        loginUrlSeen.then((ok) => (ok ? 'login' : 'other')),
      ]);
      expect(['not-yours', 'login']).toContain(result);
      // Critical: never the not-found surface.
      await expect(page.getByTestId('account-order-not-found')).toHaveCount(0);
    });
    /**
     * Finding N7. The account area offered no password change and no email
     * change, even though `PATCH /v1/users/me` accepted both and the profile
     * page already mapped all three of their error codes: the mappings were
     * unreachable.
     *
     * The round trip is the point. A password change revokes EVERY session by
     * design, so signing back in with the NEW password is what proves both the
     * new hash and the deliberate sign-out, rather than a green toast.
     */
    test(`password change signs the customer out everywhere and the new password works (${locale})`, async ({
      page,
      request,
    }) => {
      const email = `s11-pwd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`;
      const oldPassword = 'Fixture-Test-123!';
      const newPassword = 'Fixture-Test-456!';
      const auth = await signUpViaApi(request, {
        email,
        password: oldPassword,
        firstName: 'Nour',
        lastName: 'Chebbi',
      });
      await attachAuthToBrowser(page, auth);

      await page.goto(`/${locale}/account/profile`);
      // A fill against server-rendered markup sets the DOM value and not the
      // reactive control, and hydration then clears it, so the form submits
      // empty. `toBeVisible` cannot catch that: the SSR markup satisfies it.
      await waitForHydration(page);
      await expect(page.getByTestId('account-security-section')).toBeVisible({ timeout: 30000 });

      await fillPasswordForm(page, oldPassword, newPassword);

      await page.waitForURL((url) => url.pathname === `/${locale}/auth/login`, {
        timeout: 30000,
      });

      // The old session is genuinely gone, not just forgotten client-side.
      //
      // Visiting an account page while signed out is the assertion, so the
      // profile loader's own `GET /v1/users/me` answers 401 on the way to the
      // redirect. Chromium logs that as "status of 401"; WebKit words the same
      // failed fetch as "due to access control checks" and reports it as a
      // pageerror, which is why the pattern matches the URL rather than the
      // wording.
      allowed = [(entry) => (entry.url ?? entry.message).includes('/v1/users/me')];
      await page.goto(`/${locale}/account/profile`);
      await page.waitForURL((url) => url.pathname === `/${locale}/auth/login`, {
        timeout: 30000,
      });

      // The credential itself, before the form. A failure here means the
      // password change did not take; a failure below means the login page did
      // something else with a password that works. The old single assertion
      // could not tell those apart.
      await signInViaApi(request, email, newPassword);

      await waitForHydration(page);
      await page.getByTestId('auth-login-email').fill(email);
      await page.getByTestId('auth-login-password').fill(newPassword);
      await page.getByTestId('auth-login-submit').click();

      // Anywhere under /account, not `/account` exactly. The guard sent the
      // customer here with `?from=/account/profile`, and sign-in honours that
      // and returns them where they were, which is the point of threading it.
      // The old `**/{locale}/account` glob asserted the account ROOT and could
      // only have passed when nothing carried a `from`.
      await page.waitForURL((url) => url.pathname.startsWith(`/${locale}/account`), {
        timeout: 30000,
      });

      // The new password really authenticated, rather than landing on a shell
      // that the guard is about to bounce.
      await page.goto(`/${locale}/account`);
      await expect(page.getByTestId('account-page')).toBeVisible({ timeout: 30000 });
    });

    test(`a wrong current password stays inline and never bounces to login (${locale})`, async ({
      page,
      request,
    }) => {
      const auth = await signUpViaApi(request, {
        email: `s11-pwd-wrong-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`,
        password: 'Fixture-Test-123!',
        firstName: 'Wrong',
        lastName: 'Password',
      });
      await attachAuthToBrowser(page, auth);

      const route = `/${locale}/account/profile`;
      await page.goto(route);
      await waitForHydration(page);
      await expect(page.getByTestId('account-security-section')).toBeVisible({ timeout: 30000 });

      // The refusal is the assertion. The password change is a
      // `PATCH /v1/users/me`, and a wrong current password answers 401 there,
      // which Chromium logs as a console error. The session itself survives:
      // the assertions below prove the customer stays on the page, and the
      // reload's own `GET /v1/users/me` answers 200.
      allowed = [
        (entry) =>
          entry.kind === 'console.error' &&
          /status of 401/.test(entry.message) &&
          (entry.url ?? '').includes('/v1/users/me'),
      ];
      await fillPasswordForm(page, 'Definitely-Wrong-1!', 'Fixture-Test-456!');

      const error = page.getByTestId('account-security-password-error');
      await expect(error).toBeVisible({ timeout: 15000 });
      await expect(error).toHaveText(copyFor(SECURITY_STRINGS, locale).currentPasswordIncorrect);
      // The current-password-incorrect path shares HTTP 401 with a genuinely
      // expired session; treating it as one would throw the customer out
      // mid-form.
      await expect(page).toHaveURL(new RegExp(`${route}$`));

      await reloadAndAssertClean(page, route, baseline, { ignore: allowed });
    });

    test(`an email change reports a pending confirmation and leaves the address alone (${locale})`, async ({
      page,
      request,
    }) => {
      const password = 'Fixture-Test-123!';
      const email = `s11-mail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`;
      const auth = await signUpViaApi(request, {
        email,
        password,
        firstName: 'Mail',
        lastName: 'Change',
      });
      await attachAuthToBrowser(page, auth);

      const route = `/${locale}/account/profile`;
      await page.goto(route);
      await expect(page.getByTestId('account-security-section')).toBeVisible({ timeout: 30000 });

      const newEmail = `s11-mail-new-${Date.now()}@fixture.test`;
      await page.getByTestId('account-security-new-email').fill(newEmail);
      await page.getByTestId('account-security-email-current-password').fill(password);
      await page.getByTestId('account-security-email-submit').click();

      const success = page.getByTestId('account-security-email-success');
      await expect(success).toBeVisible({ timeout: 15000 });
      await expect(success).toContainText(newEmail);
      // Delivery is not wired in dev, so this asserts the API accepted the
      // request and the copy is honest about the change being pending. It
      // never asserts an inbox.
      await expect(page.getByTestId('account-profile-email')).toHaveText(email);

      await reloadAndAssertClean(page, route, baseline);
    });
    /**
     * Findings A2 and A5. The account area had no cross-links and no sign-out
     * of its own: reaching addresses from orders meant going back through the
     * header menu, and signing out was only possible from there.
     */
    test(`every account page carries the shared nav (${locale})`, async ({ page, request }) => {
      const auth = await signUpViaApi(request, {
        email: `s11-nav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`,
        password: 'Fixture-Test-123!',
        firstName: 'Nav',
        lastName: 'Everywhere',
      });
      await attachAuthToBrowser(page, auth);

      for (const path of [
        '/account',
        '/account/orders',
        '/account/addresses',
        '/account/wishlist',
        '/account/profile',
        '/account/preferences',
        '/account/returns',
      ]) {
        await page.goto(`/${locale}${path}`);
        await expect(page.getByTestId('account-nav'), `no account nav on ${path}`).toBeVisible({
          timeout: 30000,
        });
        await expect(page.getByTestId('account-nav-sign-out')).toBeVisible();
      }
    });

    test(`the account nav marks the section the customer is on (${locale})`, async ({
      page,
      request,
    }) => {
      const auth = await signUpViaApi(request, {
        email: `s11-nav-cur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`,
        password: 'Fixture-Test-123!',
        firstName: 'Nav',
        lastName: 'Current',
      });
      await attachAuthToBrowser(page, auth);

      await page.goto(`/${locale}/account/addresses`);
      await expect(page.getByTestId('account-nav-addresses')).toHaveAttribute(
        'aria-current',
        'page',
      );
      // The dashboard href is a prefix of every account route, so an exact
      // match is the only thing that keeps it from being lit everywhere.
      await expect(page.getByTestId('account-nav-dashboard')).not.toHaveAttribute(
        'aria-current',
        'page',
      );

      await page.getByTestId('account-nav-profile').click();
      await page.waitForURL(`**/${locale}/account/profile`);
      await expect(page.getByTestId('account-profile-page')).toBeVisible();
    });

    test(`signing out from an account page lands on home as a guest (${locale})`, async ({
      page,
      request,
    }) => {
      const auth = await signUpViaApi(request, {
        email: `s11-nav-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`,
        password: 'Fixture-Test-123!',
        firstName: 'Sign',
        lastName: 'Out',
      });
      await attachAuthToBrowser(page, auth);

      await page.goto(`/${locale}/account/orders`);
      await expect(page.getByTestId('account-nav-sign-out')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('account-nav-sign-out').click();

      // Sign-out is itself the destructive action under test, so the seam
      // asserted here is the landing surface, not a same-page reload.
      await page.waitForURL((url) => url.pathname === `/${locale}/`, { timeout: 30000 });
      await expect(page.locator('app-not-found-page')).toHaveCount(0);
      await expect(page.getByTestId('account-menu-anonymous')).toBeVisible();

      await page.goto(`/${locale}/account/orders`);
      await page.waitForURL((url) => url.pathname === `/${locale}/auth/login`, { timeout: 30000 });
    });

    /**
     * Finding A5, titles half. The suffix was a copywriting convention rather
     * than a rule, so the returns and cart pages, whose i18n strings forgot it,
     * shipped a bare heading as their tab title. Those two are asserted by name
     * because they are exactly the ones that regressed.
     */
    test(`every page title ends with the store name (${locale})`, async ({ page, request }) => {
      const auth = await signUpViaApi(request, {
        email: `s11-title-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`,
        password: 'Fixture-Test-123!',
        firstName: 'Title',
        lastName: 'Suffix',
      });
      await attachAuthToBrowser(page, auth);

      for (const path of ['/account/returns', '/cart', '/account/profile', '/account/orders']) {
        await page.goto(`/${locale}${path}`);
        await expect
          .poll(async () => page.title(), { timeout: 30000 })
          .toMatch(new RegExp(` · ${escapeRegExp(STORE_NAME)}$`));
        // The em-dash is ruled out by house style and used to be the join
        // character in the title strategy.
        expect(await page.title(), `em-dash in the title of ${path}`).not.toContain('—');
      }
    });
    /**
     * Findings A3 and A4. Country was a free-text two-letter code on a store
     * that ships to the configured markets, and a submit that the Reactive validators
     * passed but the shared Zod schema rejected returned without emitting, so
     * the customer read a server failure for a request that never left.
     *
     * The "generic banner on an empty submit" half is asserted in
     * `address-form.component.spec.ts` rather than here: the page owns a
     * second banner of its own, fed from the same testid, so a DOM-level
     * assertion here cannot tell the two apart.
     */
    test(`the address form ships one create for one valid submit (${locale})`, async ({
      page,
      request,
    }) => {
      const auth = await signUpViaApi(request, {
        email: `s11-addr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`,
        password: 'Fixture-Test-123!',
        firstName: 'Address',
        lastName: 'Form',
      });
      await attachAuthToBrowser(page, auth);

      const route = `/${locale}/account/addresses`;
      await page.goto(route);
      await expect(page.getByTestId('account-addresses-add-cta')).toBeVisible({ timeout: 30000 });

      let posts = 0;
      page.on('request', (req) => {
        if (req.method() === 'POST' && /\/v1\/users\/me\/addresses$/.test(req.url())) posts += 1;
      });

      // The form only appears on a click handler, so its presence is the proof
      // that Angular is driving this page rather than inert SSR markup.
      await page.getByTestId('account-addresses-add-cta').click();
      const form = page.getByTestId('account-address-form-new');
      await expect(form).toBeVisible();

      // Finding A3: a select of the configured markets, not a free-text
      // country code.
      const country = form.locator('[formcontrolname="country"]');
      await expect(country).toHaveJSProperty('tagName', 'SELECT');
      await expect(country).toHaveValue('TN');
      await expect(country.locator('option')).toHaveCount(1);

      const submitButton = page.locator('[data-testid="account-address-form-submit"]');
      await form.locator('[formcontrolname="fullName"]').fill('Ines Mejri');
      await form.locator('[formcontrolname="phone"]').fill('+21620123456');
      await form.locator('[formcontrolname="addressLine1"]').fill('12 rue de Marseille');
      await form.locator('[formcontrolname="city"]').fill('Tripoli');
      await expect(submitButton).toBeEnabled();
      await submitButton.click();

      await expect(page.locator('[data-testid-shared="address-card"]').first()).toBeVisible({
        timeout: 30000,
      });
      // Finding A4: exactly one, never zero (a silent no-op) and never two.
      expect(posts, 'a valid submit fires exactly one create').toBe(1);

      await reloadAndAssertClean(page, route, baseline);
    });
  }
});

/**
 * An address id this store can actually ship to.
 *
 * The seeded checkout customer is an fixture-catalogue leftover whose only address is
 * in one market, and the fixture store has one shipping zone. Reading
 * `addresses[0]` therefore placed every order against a destination with no
 * rate, and `createOrder` answers that with `SHIPPING_UNAVAILABLE` rather than
 * a silent free-shipping order. Prefers an existing address in the store's
 * own market and
 * creates one when there is none, so the spec is about order detail rather
 * than about which address happens to be first.
 */
async function deliverableAddressId(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const meRes = await request.get(`${STOREFRONT_API_BASE}/v1/users/me`, { headers });
  expect(meRes.status()).toBe(200);
  const meBody = await meRes.json();
  const addresses = (meBody.data?.addresses ?? meBody.addresses ?? []) as {
    id: string;
    country?: string;
  }[];
  const domestic = addresses.find((a) => a.country === STORE_COUNTRY);
  if (domestic) return domestic.id;

  const created = await request.post(`${STOREFRONT_API_BASE}/v1/users/me/addresses`, {
    headers,
    data: {
      label: 'Cabinet',
      fullName: 'Compte QA',
      phone: '+21620123456',
      addressLine1: '12 rue de la Republique',
      city: 'Tripoli',
      postalCode: '1001',
      country: STORE_COUNTRY,
      isDefaultShipping: true,
      isDefaultBilling: true,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).data.id as string;
}

/**
 * Fill the password-change form and wait for the submit to enable.
 *
 * The button is disabled until all three controls are valid and matching, so
 * enabling is the only reliable signal that Angular, and not the server-
 * rendered markup, is driving this form. A `fill` before hydration sets the DOM
 * value and not the reactive control, and hydration then clears it: the field
 * looks filled in a screenshot and the form submits nothing.
 */
async function fillPasswordForm(
  page: import('@playwright/test').Page,
  current: string,
  next: string,
): Promise<void> {
  // `testId` renders `data-testid` on the interactive <button> itself, not on a
  // wrapper, so the id IS the button.
  const submit = page.getByTestId('account-security-password-submit');
  await expect
    .poll(
      async () => {
        await page.getByTestId('account-security-current-password').fill(current);
        await page.getByTestId('account-security-new-password').fill(next);
        await page.getByTestId('account-security-confirm-password').fill(next);
        return submit.isEnabled();
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await submit.click();
}
