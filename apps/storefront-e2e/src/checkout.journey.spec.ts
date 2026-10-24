import { randomUUID } from 'node:crypto';

import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  apiHeaders,
  attachConsoleBaseline,
  authCookieHeader,
  copyFor,
  describeEveryLocale,
  fixtureShippableAddress,
  reloadAndAssertClean,
  signInAsAdmin,
  signInViaApi,
  signUpViaApi,
  type AuthSession,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';
import type { APIRequestContext } from '@playwright/test';
import { getChromeStrings } from '../../storefront/src/i18n';

/**
 * Phase S10: the checkout (COD) journey.
 *
 * Drives the live storefront against the real test API at 53001. Per
 * constitution §3.8 no `page.route()` mocking and no fixtures: every
 * assertion crosses the wire.
 *
 * The full live-checkout journey (cart add, checkout submit, confirmation,
 * idempotency replay) gates behind `STOREFRONT_E2E_BUILT=1` per S6 / S8 /
 * S9 precedent (clarifications §1.23 + §1.27) because Vite SSR cold-start
 * exceeds the parallel-worker per-test budget on the dev server. The unit +
 * component tier exhaustively covers the wiring (`checkout/index.page.spec`,
 * `place-order-cta.spec`, `address-picker.spec`, `order-summary.spec`,
 * `orders.service.spec`, the backend canonical at `test/orders.e2e-spec.ts`
 * idempotency-replay branch, and the schema parity spec).
 *
 * The dev-server tier here covers the SSR shell rendering of /checkout and
 * /order-confirmation/:n in both locales plus an axe sweep on each.
 */

const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';
const SEED_EMAIL = 'cod-test+fixture@fixture.test';
const SEED_PASSWORD = 'Fixture-Test-123!';

/** `checkout.steps.stepState`, verbatim from `apps/storefront/src/i18n`. */
const STEP_STATE_CURRENT: Record<string, string> = { fr: 'En cours', en: 'Current', ar: 'الحالية' };
const STEP_STATE_DONE: Record<string, string> = { fr: 'Terminée', en: 'Done', ar: 'تم' };
/**
 * The tax mention the collapsed step-2 recap must carry (K3).
 *
 * Deliberately the tax-inclusive string and not `money.taxDisplay`: the recap
 * shows the payable total, which includes tax whatever the catalogue displays.
 * A store whose catalogue quotes tax-exclusive prices still owes a
 * tax-inclusive figure at checkout, so reading the configured catalogue
 * display here asserted the wrong half of the flow.
 */
const taxMentionFor = (locale: StorefrontLocale): string =>
  getChromeStrings(locale).generic.taxIncluded;

/**
 * Serial, and not by preference. The D2 journey below disables every payment
 * method for the length of one test, which is global store state every other
 * checkout test reads: run in parallel, the fr branch's teardown races the en
 * branch's payment step and both report a defect neither has. `fullyParallel`
 * comes from the Nx preset, so this file opts out explicitly.
 */
test.describe.configure({ mode: 'serial' });

describeEveryLocale('storefront S10 checkout journey', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`anonymous /checkout SSR shell renders without crashing (${locale})`, async ({ page }) => {
    // Anonymous request hits the page; the hydration redirect to /auth/login
    // happens after the bundle boots. Assert the SSR shell is well-formed.
    const response = await page.goto(`/${locale}/checkout`);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByTestId('checkout-page')).toBeVisible();
  });

  test(`anonymous /order-confirmation/:n SSR shell renders without crashing (${locale})`, async ({
    page,
  }) => {
    const response = await page.goto(`/${locale}/order-confirmation/AKL-DOES-NOT-EXIST`);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByTestId('order-confirmation-page')).toBeVisible();
  });

  test(`axe wcag22aa zero serious / critical on the /checkout SSR shell (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/checkout`);
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

  test(`axe wcag22aa zero serious / critical on the /order-confirmation SSR shell (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/order-confirmation/AKL-DOES-NOT-EXIST`);
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

  test(`the consent line links to the real policy pages (${locale})`, async ({ page, request }) => {
    // A fresh customer per run, so no other spec's cart or address shapes this
    // one. AUTH_SKIP_EMAIL_VERIFICATION=1 on the e2e API means the sign-up
    // response already carries an authenticated session.
    const session = await signUpViaApi(request, {
      email: `c7-consent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
      password: 'Fixture-Test-123!',
      firstName: 'Consent',
      lastName: 'Links',
    });
    const headers = {
      Cookie: authCookieHeader(session),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': locale,
    };
    await createDefaultAddress(request, session, locale);
    await addFirstVariantToCart(request, headers, locale);
    await page.context().addCookies(session.cookies);

    await page.goto(`/${locale}/checkout`);
    await expect(page.getByTestId('checkout-page')).toBeVisible({ timeout: 60_000 });

    // The CTA lives in the last step, and a step shell only projects its
    // content while it is the active step, so every earlier step has to be
    // confirmed: address, delivery method, summary, then payment.
    for (const step of [1, 2, 3, 4]) {
      const advance = page.locator(
        `[data-testid="checkout-step-shell"][data-step="${step}"] .step-actions button`,
      );
      await expect(advance).toBeVisible({ timeout: 60_000 });
      await advance.click();
    }

    const terms = page.getByTestId('place-order-terms-link');
    const privacy = page.getByTestId('place-order-privacy-link');
    // The exact route, never toBeTruthy() on href: both pointed at the home
    // page, which is a perfectly truthy href for a link that goes nowhere near
    // the terms a customer is being asked to accept.
    await expect(terms).toHaveAttribute('href', `/${locale}/policies/terms`);
    await expect(privacy).toHaveAttribute('href', `/${locale}/policies/privacy`);

    await terms.click();
    await expect(page.locator('#policy-heading')).toBeVisible({ timeout: 60_000 });
    expect(new URL(page.url()).pathname).toBe(`/${locale}/policies/terms`);
  });

  /**
   * Plan M phase M5 - the step chrome says where the shopper is and what they
   * are about to pay (findings K1, K3, K5).
   *
   * The state chip used to repeat the step's own title, the collapsed step-2
   * line carried a bare count with no unit and no figure, and each address
   * radio inherited its accessible name from the surrounding label's whole text
   * run, badge and phone number included.
   */
  test(`step chrome names the state, the recap and each address (${locale})`, async ({
    page,
    request,
  }) => {
    const session = await signUpViaApi(request, {
      email: `m5-chrome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
      password: 'Fixture-Test-123!',
      firstName: 'Badii',
      lastName: 'QA',
    });
    const headers = {
      Cookie: authCookieHeader(session),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': locale,
    };
    // The radio is named after the ADDRESS recipient, not the account holder,
    // so the address has to carry the name this spec looks for. It asserted
    // `Badii QA` against a helper that hardcoded `Consent Links`, which is why
    // it could never pass: plan M wrote it and never ran it.
    await createDefaultAddress(request, session, locale, 'Badii QA');
    await addFirstVariantToCart(request, headers, locale);
    await page.context().addCookies(session.cookies);

    await page.goto(`/${locale}/checkout`);
    await expect(page.getByTestId('checkout-page')).toBeVisible({ timeout: 60_000 });

    // K5: the radio answers to the recipient's name on its own, not to the
    // label text run it sits inside.
    await expect(page.getByRole('radio', { name: /Badii QA/ })).toBeVisible({ timeout: 60_000 });

    const step1 = page.locator('[data-testid="checkout-step-shell"][data-step="1"]');
    const step2 = page.locator('[data-testid="checkout-step-shell"][data-step="2"]');
    // The summary is step 3 since the delivery-method step landed (finding D3).
    const step3 = page.locator('[data-testid="checkout-step-shell"][data-step="3"]');

    // K1: an active step reads a state word, never its own heading back.
    // Scoped to the step HEADER: a bare `.badge` under the step also matches
    // the address picker's own "Default" chip, which is a strict-mode
    // violation, not a state word. Plan M wrote this and never ran it.
    const step1Badge = step1.locator('.head > .badge');
    await expect(step1Badge).toHaveText(copyFor(STEP_STATE_CURRENT, locale));
    await expect(step1Badge).not.toHaveText(await step1.locator('.title').innerText());

    await step1.locator('.step-actions button').click();
    await expect(step1Badge).toHaveText(copyFor(STEP_STATE_DONE, locale));

    await step2.locator('.step-actions button').click();
    await step3.locator('.step-actions button').click();

    // K3: the collapsed recap carries the count AND the tax-inclusive total.
    const recap = step3.locator('[data-testid="checkout-step-summary"]');
    await expect(recap).toBeVisible();
    await expect(recap).toContainText(/\d/);
    await expect(recap).toContainText(taxMentionFor(locale));

    await reloadAndAssertClean(page, `/${locale}/checkout`, baseline);
  });

  /**
   * Plan F phase F4 - finding D3.
   *
   * Two methods are ACTIVE on the domestic zone (Standard delivery, the zone
   * default, and Express delivery). Checkout offered neither: the page
   * called `GET /v1/cart/estimate` only to prime the VAT row and dropped its
   * `rates` array, so every order silently recorded the zone default with no
   * customer input.
   */
  test(`the delivery step lists every active method and honours the choice (${locale})`, async ({
    page,
    request,
  }) => {
    const session = await signUpViaApi(request, {
      email: `f4-shipping-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
      password: 'Fixture-Test-123!',
      firstName: 'Shipping',
      lastName: 'Chooser',
    });
    const headers = {
      Cookie: authCookieHeader(session),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': locale,
    };
    await createDefaultAddress(request, session, locale);
    await addFirstVariantToCart(request, headers, locale);
    await page.context().addCookies(session.cookies);

    const { country, postalCode } = fixtureShippableAddress();
    const quotes = await request.get(
      `${STOREFRONT_API_BASE}/v1/cart/estimate?country=${country}&postalCode=${postalCode}`,
      { headers },
    );
    expect(quotes.status()).toBe(200);
    const rates = ((await quotes.json()).data?.rates ?? []) as {
      methodId: string;
      isDefault?: boolean;
    }[];
    expect(rates.length, 'the domestic zone seeds two active methods').toBeGreaterThan(1);
    const alternate = rates.find((r) => !r.isDefault);
    expect(alternate, 'the zone must expose a non-default method').toBeTruthy();

    await page.goto(`/${locale}/checkout`);
    await expect(page.getByTestId('checkout-page')).toBeVisible({ timeout: 60_000 });
    const step1 = page.locator('[data-testid="checkout-step-shell"][data-step="1"]');
    await step1.locator('.step-actions button').click();

    // Every active rate is offered, and the zone default is preselected.
    const options = page.locator('[data-testid^="shipping-method-option-"]');
    await expect(options).toHaveCount(rates.length, { timeout: 60_000 });
    const defaultId = rates.find((r) => r.isDefault)?.methodId ?? rates[0].methodId;
    await expect(
      page.locator(`[data-testid="shipping-method-option-${defaultId}"] input`),
    ).toBeChecked();

    // Picking the other method moves the money, which is the half the discard
    // made impossible. Read the total before and after rather than asserting a
    // seeded figure: the seed owns the prices, this spec owns the behaviour.
    const step2 = page.locator('[data-testid="checkout-step-shell"][data-step="2"]');
    await step2.locator('.step-actions button').click();
    const total = page.getByTestId('order-summary-total');
    await expect(total).toBeVisible({ timeout: 60_000 });
    const before = await total.innerText();

    await page.locator('[data-testid="checkout-step-shell"][data-step="2"] .edit').click();
    await page
      .locator(`[data-testid="shipping-method-option-${alternate!.methodId}"] input`)
      .click();
    await step2.locator('.step-actions button').click();
    await expect(total).not.toHaveText(before, { timeout: 60_000 });

    await reloadAndAssertClean(page, `/${locale}/checkout`, baseline);
  });

  /**
   * Plan F phase F5 - pass-2 finding D2.
   *
   * The store had zero payment methods configured, checkout printed a
   * hardcoded "Place order, Cash on Delivery" and the order went through
   * anyway, recording a tender nobody had configured and nobody had chosen.
   * With every method disabled the page must say the store cannot take the
   * order, and the CTA must refuse it.
   */
  test(`checkout refuses the order when no payment method is enabled (${locale})`, async ({
    page,
    request,
  }) => {
    const admin = await signInAsAdmin(request);
    const adminHeaders = apiHeaders(admin, locale as 'fr' | 'en');
    const list = await request.get(`${STOREFRONT_API_BASE}/v1/admin/payment-methods`, {
      headers: adminHeaders,
    });
    expect(list.status()).toBe(200);
    const rows = ((await list.json()).data ?? []) as { id: string; isActive: boolean }[];
    const wereActive = rows.filter((r) => r.isActive);
    expect(wereActive.length, 'the seed must enable a tender to disable').toBeGreaterThan(0);

    try {
      for (const row of wereActive) {
        const off = await request.patch(
          `${STOREFRONT_API_BASE}/v1/admin/payment-methods/${row.id}`,
          { headers: adminHeaders, data: { isActive: false } },
        );
        expect(off.status()).toBe(200);
      }

      const session = await signUpViaApi(request, {
        email: `f5-nopay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
        password: 'Fixture-Test-123!',
        firstName: 'No',
        lastName: 'Tender',
      });
      const headers = {
        Cookie: authCookieHeader(session),
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': locale,
      };
      await createDefaultAddress(request, session, locale);
      await addFirstVariantToCart(request, headers, locale);
      await page.context().addCookies(session.cookies);

      await page.goto(`/${locale}/checkout`);
      await expect(page.getByTestId('checkout-page')).toBeVisible({ timeout: 60_000 });
      // Stated at the top, before an address is asked for.
      await expect(page.getByTestId('checkout-payment-unavailable')).toBeVisible({
        timeout: 60_000,
      });

      // And the API refuses it too, so a client that ignored the page cannot
      // place a silent cash-on-delivery order either.
      const meRes = await request.get(`${STOREFRONT_API_BASE}/v1/users/me`, { headers });
      const addressId = ((await meRes.json()).data?.addresses ?? [])[0]?.id as string;
      const refused = await request.post(`${STOREFRONT_API_BASE}/v1/orders`, {
        headers: {
          ...headers,
          'X-Idempotency-Key': randomUUID(),
        },
        data: { shippingAddressId: addressId },
      });
      expect(refused.status()).toBe(400);
      expect((await refused.json())?.error?.code).toBe('ORDER_PAYMENT_METHOD_UNAVAILABLE');
    } finally {
      for (const row of wereActive) {
        await request.patch(`${STOREFRONT_API_BASE}/v1/admin/payment-methods/${row.id}`, {
          headers: adminHeaders,
          data: { isActive: true },
        });
      }
    }
  });

  test(`the payment step names the enabled tender and gates the COD note (${locale})`, async ({
    page,
    request,
  }) => {
    const settings = await request.get(`${STOREFRONT_API_BASE}/v1/checkout/settings`, {
      headers: { 'Accept-Language': locale },
    });
    expect(settings.status()).toBe(200);
    const methods = ((await settings.json()).data?.paymentMethods ?? []) as {
      code: string;
      name: string;
      provider: string;
    }[];
    expect(methods.length, 'the seed must enable a tender').toBeGreaterThan(0);

    const session = await signUpViaApi(request, {
      email: `f5-pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
      password: 'Fixture-Test-123!',
      firstName: 'Payment',
      lastName: 'Chooser',
    });
    const headers = {
      Cookie: authCookieHeader(session),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': locale,
    };
    await createDefaultAddress(request, session, locale);
    await addFirstVariantToCart(request, headers, locale);
    await page.context().addCookies(session.cookies);

    await page.goto(`/${locale}/checkout`);
    await expect(page.getByTestId('checkout-page')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('checkout-payment-unavailable')).toHaveCount(0);

    for (const step of [1, 2, 3]) {
      const advance = page.locator(
        `[data-testid="checkout-step-shell"][data-step="${step}"] .step-actions button`,
      );
      await expect(advance).toBeVisible({ timeout: 60_000 });
      await advance.click();
    }

    // The tender the operator configured, by the name the API resolved for
    // this locale, not a hardcoded string in a template.
    const option = page.getByTestId(`payment-method-option-${methods[0].code}`);
    await expect(option).toBeVisible({ timeout: 60_000 });
    await expect(option).toContainText(methods[0].name);
    await expect(option.locator('input')).toBeChecked();

    await page
      .locator('[data-testid="checkout-step-shell"][data-step="4"] .step-actions button')
      .click();

    // The cash-on-delivery legal note is a claim about how the customer pays,
    // so it renders for a cod tender and for nothing else.
    const codNote = page.getByTestId('place-order-cod-note');
    await expect(codNote).toHaveCount(methods[0].provider === 'cod' ? 1 : 0);

    await reloadAndAssertClean(page, `/${locale}/checkout`, baseline);
  });

  /**
   * Plan F phase F7 - finding D1, and the D7 half of the consent line.
   *
   * `checkoutMessage`, `termsOfServiceUrl` and `postPurchaseRedirectUrl` were
   * written by the admin screen and read by nothing at all. This drives the
   * two that surface on checkout: set them, walk to the payment and place
   * steps, read them back, and restore in a `finally` so the store is left as
   * it was found.
   */
  test(`the operator message and terms URL reach the checkout page (${locale})`, async ({
    page,
    request,
  }) => {
    const admin = await signInAsAdmin(request);
    const adminHeaders = apiHeaders(admin, locale as 'fr' | 'en');
    const before = await request.get(`${STOREFRONT_API_BASE}/v1/admin/checkout/settings`, {
      headers: adminHeaders,
    });
    expect(before.status()).toBe(200);
    const original = (await before.json()).data as {
      checkoutMessage: string | null;
      termsOfServiceUrl: string | null;
    };

    const message = `QA ${locale} operator note ${Date.now()}`;
    const termsUrl = 'https://example.test/conditions-generales';
    try {
      const patched = await request.patch(`${STOREFRONT_API_BASE}/v1/admin/checkout/settings`, {
        headers: adminHeaders,
        data: { checkoutMessage: message, termsOfServiceUrl: termsUrl },
      });
      expect(patched.status()).toBe(200);

      const session = await signUpViaApi(request, {
        email: `f7-settings-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
        password: 'Fixture-Test-123!',
        firstName: 'Settings',
        lastName: 'Reader',
      });
      const headers = {
        Cookie: authCookieHeader(session),
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': locale,
      };
      await createDefaultAddress(request, session, locale);
      await addFirstVariantToCart(request, headers, locale);
      await page.context().addCookies(session.cookies);

      await page.goto(`/${locale}/checkout`);
      await expect(page.getByTestId('checkout-page')).toBeVisible({ timeout: 60_000 });
      for (const step of [1, 2, 3]) {
        const advance = page.locator(
          `[data-testid="checkout-step-shell"][data-step="${step}"] .step-actions button`,
        );
        await expect(advance).toBeVisible({ timeout: 60_000 });
        await advance.click();
      }

      // Above the tenders, which is where the setting's own DTO comment says
      // it belongs, and rendered verbatim under both locales.
      await expect(page.getByTestId('checkout-message')).toHaveText(message, { timeout: 60_000 });

      await page
        .locator('[data-testid="checkout-step-shell"][data-step="4"] .step-actions button')
        .click();
      const terms = page.getByTestId('place-order-terms-link');
      await expect(terms).toHaveAttribute('href', termsUrl, { timeout: 60_000 });
      // Off-site, so a plain anchor rather than a routerLink.
      await expect(terms).toHaveAttribute('rel', 'noopener');
      // D7: an operator URL, an unset one, whatever - never the locale home.
      expect(await terms.getAttribute('href')).not.toBe(`/${locale}`);
    } finally {
      await request.patch(`${STOREFRONT_API_BASE}/v1/admin/checkout/settings`, {
        headers: adminHeaders,
        data: {
          checkoutMessage: original.checkoutMessage,
          termsOfServiceUrl: original.termsOfServiceUrl,
        },
      });
    }
  });

  if (STOREFRONT_E2E_BUILT) {
    test(`POST /v1/orders idempotency replay returns the same order (${locale})`, async ({
      request,
    }) => {
      const auth = await signInViaApi(request, SEED_EMAIL, SEED_PASSWORD);
      const headers: Record<string, string> = {
        Cookie: authCookieHeader(auth),
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': locale,
      };

      // Pull the seeded customer's default address id from /v1/users/me.
      const meRes = await request.get(`${STOREFRONT_API_BASE}/v1/users/me`, { headers });
      expect(meRes.status()).toBe(200);
      const meBody = await meRes.json();
      const addressId = (meBody.data?.addresses ?? meBody.addresses)?.[0]?.id;
      expect(addressId, 'seeded customer must have a default address').toBeTruthy();

      // Add a featured product to the cart so /v1/orders has something to bill.
      const productsRes = await request.get(
        `${STOREFRONT_API_BASE}/v1/products?isFeatured=true&pageSize=1`,
        { headers },
      );
      expect(productsRes.status()).toBe(200);
      const products = await productsRes.json();
      const variantId = (products.data?.[0]?.variants ?? [])[0]?.id;
      expect(variantId, 'seeded catalog must expose a featured product variant').toBeTruthy();
      const addRes = await request.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
        headers,
        data: { variantId, quantity: 1 },
      });
      expect([200, 201]).toContain(addRes.status());

      // `X-Idempotency-Key` is validated as a UUID v4, so an ad-hoc string is
      // refused with IDEMPOTENCY_KEY_MALFORMED before the handler runs.
      const idemKey = randomUUID();
      const placeRes1 = await request.post(`${STOREFRONT_API_BASE}/v1/orders`, {
        headers: { ...headers, 'X-Idempotency-Key': idemKey },
        data: { shippingAddressId: addressId },
      });
      expect(placeRes1.status()).toBe(201);
      const order1 = (await placeRes1.json()).data;
      expect(order1.id).toBeTruthy();

      // Standard shipping (no explicit method → default-resolved) is charged,
      // named, and folded into the order total. Asserted under both locales.
      const detail1 = await request.get(`${STOREFRONT_API_BASE}/v1/orders/${order1.id}`, {
        headers,
      });
      expect(detail1.status()).toBe(200);
      const od = (await detail1.json()).data;
      expect(Number(od.shippingAmount)).toBeGreaterThan(0);
      expect(typeof od.shippingMethodName).toBe('string');
      expect((od.shippingMethodName as string).length).toBeGreaterThan(0);
      // Precision 3: the 0.005 tolerance of precision 2 is five times the
      // millime, so a four-millime error in the total passed unnoticed.
      expect(Number(od.total)).toBeCloseTo(
        Number(od.subtotal) -
          Number(od.discountAmount ?? 0) +
          Number(od.shippingAmount) +
          Number(od.taxAmount ?? 0),
        3,
      );

      // F4 / D3: an explicitly chosen non-default method is what the order
      // records. Without it every order took the zone default, whatever the
      // customer picked, because no id ever left the page.
      const fixtureAddress = fixtureShippableAddress();
      const quoteRes = await request.get(
        `${STOREFRONT_API_BASE}/v1/cart/estimate?country=${fixtureAddress.country}&postalCode=${fixtureAddress.postalCode}`,
        { headers },
      );
      const quoted = ((await quoteRes.json()).data?.rates ?? []) as {
        methodId: string;
        name: string;
        price: string | number;
        isDefault?: boolean;
      }[];
      const alternate = quoted.find((r) => !r.isDefault);
      if (alternate) {
        await request.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
          headers,
          data: { variantId, quantity: 1 },
        });
        const altRes = await request.post(`${STOREFRONT_API_BASE}/v1/orders`, {
          headers: {
            ...headers,
            'X-Idempotency-Key': randomUUID(),
          },
          data: { shippingAddressId: addressId, shippingMethodId: alternate.methodId },
        });
        expect(altRes.status()).toBe(201);
        const altOrder = (await altRes.json()).data;
        expect(Number(altOrder.shippingAmount)).toBeCloseTo(Number(alternate.price), 3);
        expect(altOrder.shippingMethodName).not.toBe(od.shippingMethodName);
      }

      const placeRes2 = await request.post(`${STOREFRONT_API_BASE}/v1/orders`, {
        headers: { ...headers, 'X-Idempotency-Key': idemKey },
        data: { shippingAddressId: addressId },
      });
      expect(placeRes2.status()).toBe(201);
      const order2 = (await placeRes2.json()).data;
      expect(order2.id, 'replayed key must return the original order id').toBe(order1.id);
    });
  }
});

/** Mirrors the recipe in price-tax-mention.journey.spec.ts. */
async function createDefaultAddress(
  request: APIRequestContext,
  session: AuthSession,
  locale: string,
  fullName = 'Consent Links',
): Promise<void> {
  const res = await request.post(`${STOREFRONT_API_BASE}/v1/users/me/addresses`, {
    headers: {
      Cookie: authCookieHeader(session),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': locale,
    },
    data: {
      label: 'Cabinet',
      ...fixtureShippableAddress({ fullName }),
      isDefaultShipping: true,
      isDefaultBilling: true,
    },
  });
  expect(res.status(), 'POST /v1/users/me/addresses must create the checkout address').toBe(201);
}

/** First seeded variant that is in stock, so the add cannot be refused. */
async function addFirstVariantToCart(
  request: APIRequestContext,
  headers: Record<string, string>,
  locale: string,
): Promise<void> {
  const res = await request.get(`${STOREFRONT_API_BASE}/v1/products?pageSize=24`, {
    headers: { 'Accept-Language': locale },
  });
  expect(res.status(), 'GET /v1/products must answer 200 for the seeded catalogue').toBe(200);
  const body = (await res.json()) as { data?: unknown };
  const rows: unknown[] = Array.isArray(body.data) ? body.data : [];

  let fallback: string | null = null;
  let inStock: string | null = null;
  for (const row of rows) {
    const variants = (row as { variants?: unknown }).variants;
    for (const entry of Array.isArray(variants) ? variants : []) {
      const variant = entry as { id?: unknown; availability?: unknown };
      if (typeof variant.id !== 'string') continue;
      fallback ??= variant.id;
      if (variant.availability === 'IN_STOCK') {
        inStock = variant.id;
        break;
      }
    }
    if (inStock) break;
  }
  const variantId = inStock ?? fallback;
  expect(variantId, 'the seeded catalogue must expose a purchasable variant').not.toBeNull();

  const add = await request.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
    headers,
    data: { variantId, quantity: 1 },
  });
  expect([200, 201], 'POST /v1/cart/items must succeed').toContain(add.status());
}
