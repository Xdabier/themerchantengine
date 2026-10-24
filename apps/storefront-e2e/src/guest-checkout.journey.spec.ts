import { expect, request as apiRequest, test } from '@playwright/test';
import type { APIRequestContext, BrowserContext } from '@playwright/test';

import {
  apiHeaders,
  attachConsoleBaseline,
  describeEveryLocale,
  fixtureShippableAddress,
  reloadAndAssertClean,
  signInAsAdmin,
  STOREFRONT_API_BASE,
  type AssertCleanOptions,
  type ConsoleBaseline,
} from './support';

/**
 * Plan F phase F6 — checkout with no account (findings K3, D1).
 *
 * `guestCheckoutEnabled` was stored, round-tripped by admin, and read by
 * nothing: the storefront bounced every anonymous visitor to login, and
 * `POST /v1/orders` refused them one layer down. The whole flow below was
 * impossible at the API design level, not just missing from the UI.
 *
 * Runs in a context with no session cookies beyond the anonymous cart's, which
 * is the entire point: the customer never signs in, never has an account, and
 * still places and finds their order.
 */
const API_BASE = process.env['STOREFRONT_API_URL'] ?? 'http://localhost:53001/api';
const STOREFRONT_ORIGIN =
  process.env['BASE_URL'] ?? `http://localhost:${process.env['STOREFRONT_DEV_PORT'] ?? '53311'}`;

function guestEmail(tag: string): string {
  return `guest-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
}

/**
 * The first IN_STOCK variant of the seeded catalogue.
 *
 * Stock matters: the first variant in list order is not necessarily one the
 * cart will accept, and an out-of-stock refusal here reads as "guest carts are
 * broken" rather than "that product is sold out".
 */
async function firstVariantId(req: APIRequestContext, locale: string): Promise<string> {
  const res = await req.get(`${API_BASE}/v1/products?pageSize=24`, {
    headers: { 'Accept-Language': locale },
  });
  expect(res.ok(), 'GET /v1/products must answer for the seeded catalogue').toBe(true);
  const rows = ((await res.json()).data ?? []) as {
    variants?: { id?: string; availability?: string }[];
  }[];
  let fallback: string | null = null;
  for (const row of rows) {
    for (const variant of row.variants ?? []) {
      if (typeof variant.id !== 'string') continue;
      fallback ??= variant.id;
      if (variant.availability === 'IN_STOCK') return variant.id;
    }
  }
  if (fallback) return fallback;
  throw new Error('the seeded catalogue exposes no variant');
}

/**
 * An anonymous cart holding one line, with its `sessionId` handed to the
 * browser. The cookie is `HttpOnly` in production; the browser context sets a
 * readable copy so the page and the API agree on which cart is being bought.
 */
async function seedAnonymousCart(
  req: APIRequestContext,
  context: BrowserContext,
  locale: string,
): Promise<void> {
  const variantId = await firstVariantId(req, locale);
  const res = await req.post(`${API_BASE}/v1/cart/items`, {
    data: { variantId, quantity: 1 },
    headers: { 'Accept-Language': locale },
  });
  expect(res.ok(), `anonymous add to cart must succeed: ${await res.text()}`).toBe(true);
  const sessionId = /sessionId=([^;]+)/.exec(res.headers()['set-cookie'] ?? '')?.[1];
  expect(sessionId, 'the anonymous add must mint a sessionId cookie').toBeTruthy();
  await context.addCookies([
    {
      name: 'sessionId',
      value: sessionId!,
      url: STOREFRONT_ORIGIN,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

describeEveryLocale('storefront guest checkout journey', (locale) => {
  let baseline: ConsoleBaseline;
  /**
   * The wrong-email step drives the track lookup into a deliberate 404, and
   * Chromium logs every failed request as a console error. Scoped per test so
   * the rest of the journey stays strict.
   */
  let allowed: NonNullable<AssertCleanOptions['ignore']> = [];
  /** The store's flag before this file touched it, restored on the way out. */
  let flagBefore: boolean | null = null;

  /**
   * The journey owns its own precondition.
   *
   * The seed writes `guestCheckoutEnabled` create-only, deliberately, so that a
   * deploy never overrides an operator who switched it off. The consequence for
   * a shared test database is that an earlier suite which flipped it off leaves
   * it off through every reseed, and this whole journey then reports "guest
   * checkout is broken" when the truth is "guest checkout is disabled".
   */
  test.beforeAll(async ({ playwright }) => {
    const req = await playwright.request.newContext();
    try {
      const admin = await signInAsAdmin(req);
      const headers = apiHeaders(admin, locale);
      const current = await req.get(`${STOREFRONT_API_BASE}/v1/checkout/settings`, { headers });
      flagBefore = ((await current.json()).data?.checkout?.guestCheckoutEnabled ?? null) as
        | boolean
        | null;
      const res = await req.patch(`${STOREFRONT_API_BASE}/v1/admin/checkout/settings`, {
        headers,
        data: { guestCheckoutEnabled: true },
      });
      expect(res.status(), await res.text()).toBe(200);
    } finally {
      await req.dispose();
    }
  });

  test.afterAll(async ({ playwright }) => {
    if (flagBefore === null || flagBefore === true) return;
    const req = await playwright.request.newContext();
    try {
      const admin = await signInAsAdmin(req);
      await req.patch(`${STOREFRONT_API_BASE}/v1/admin/checkout/settings`, {
        headers: apiHeaders(admin, locale),
        data: { guestCheckoutEnabled: flagBefore },
      });
    } finally {
      await req.dispose();
    }
  });

  test.beforeEach(({ page }) => {
    allowed = [];
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean({ ignore: allowed });
  });

  test(`a guest places an order and finds it again (${locale})`, async ({ page, context }) => {
    const req = await apiRequest.newContext();
    try {
      await seedAnonymousCart(req, context, locale);
      const email = guestEmail('flow');

      // 1. Checkout admits the guest. It used to redirect here, always.
      await page.goto(`/${locale}/checkout`);
      await expect(page.getByTestId('checkout-page')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('guest-email')).toBeVisible({ timeout: 60_000 });
      expect(new URL(page.url()).pathname, 'no login wall for a guest').toBe(`/${locale}/checkout`);
      // Signing in is offered, never forced.
      await expect(page.getByTestId('checkout-guest-signin')).toBeVisible();

      // 2. Contact and address, both typed: a guest owns no saved address.
      await page.getByTestId('guest-email').fill(email);
      await expect(page.getByTestId('address-field-fullName')).toBeVisible({ timeout: 60_000 });
      await fillAddress(page);
      await page.getByTestId('address-form-submit').click();

      const step1 = page.locator('[data-testid="checkout-step-shell"][data-step="1"]');
      await expect(step1.locator('.step-actions button')).toBeVisible({ timeout: 60_000 });
      await step1.locator('.step-actions button').click();

      // 3. Delivery, summary, payment: the same steps a customer walks.
      for (const step of [2, 3, 4]) {
        const advance = page.locator(
          `[data-testid="checkout-step-shell"][data-step="${step}"] .step-actions button`,
        );
        await expect(advance).toBeVisible({ timeout: 60_000 });
        await advance.click();
      }

      // 4. Place it.
      await page.getByTestId('place-order-accept-terms').check();
      await page.getByTestId('place-order-form').getByRole('button').click();

      await expect(page.getByTestId('order-confirmation-number')).toBeVisible({ timeout: 60_000 });
      const orderNumber = (await page.getByTestId('order-confirmation-number').innerText()).match(
        /[A-Z]+-\d{4}-\d+/,
      )?.[0];
      expect(orderNumber, 'the confirmation must name the order number').toBeTruthy();
      await expect(page.getByTestId('order-confirmation-total')).toBeVisible();

      // 5. The order is findable later, from any device, with the number and
      // the email. This is the guest's only durable handle on it.
      //
      // Followed as a link from the confirmation rather than by `goto`, for two
      // reasons: it is the inbound path the confirmation page exists to offer
      // (finding N3), and a fresh `goto` fills server-rendered markup that
      // hydration then resets, which is a race this suite has been bitten by
      // before (see the forgot-password journey).
      await page.getByTestId('order-confirmation-public-track').click();
      await expect(page.getByTestId('track-page')).toBeVisible({ timeout: 60_000 });
      // The confirmation hands the number over; the email is still required,
      // so the link grants no access on its own.
      await expect(page.getByTestId('track-order-number-input')).toHaveValue(orderNumber!, {
        timeout: 30_000,
      });
      await page.getByTestId('track-email-input').fill(email);
      await page.getByTestId('track-submit').click();
      await expect(page.getByTestId('track-result')).toBeVisible({ timeout: 60_000 });

      // 6. Unhappy path, same locale: the wrong email finds nothing rather
      // than leaking the order to whoever holds the number. The refusal is a
      // 404 by design, which Chromium logs as a console error.
      // A RegExp rule matches the console MESSAGE, which here is Chromium's
      // generic "Failed to load resource" line; the route is only in the
      // entry's url. So the rule is a predicate over both.
      allowed = [
        (entry) =>
          entry.kind === 'console.error' &&
          /status of 404/.test(entry.message) &&
          (entry.url ?? '').includes('/v1/orders/track'),
      ];
      await page.getByTestId('track-email-input').fill(`not-${email}`);
      await page.getByTestId('track-submit').click();
      await expect(page.getByTestId('track-not-found')).toBeVisible({ timeout: 60_000 });

      await reloadAndAssertClean(page, `/${locale}/track`, baseline, { ignore: allowed });
    } finally {
      await req.dispose();
    }
  });

  /**
   * The operator's scope boundary: guest checkout buys, it does not become an
   * account. Wishlist, reviews and questions still require one.
   */
  test(`a guest is still asked to sign in for the wishlist (${locale})`, async ({
    page,
    context,
  }) => {
    const req = await apiRequest.newContext();
    try {
      await seedAnonymousCart(req, context, locale);
      const res = await req.get(`${API_BASE}/v1/products?pageSize=1`, {
        headers: { 'Accept-Language': locale },
      });
      const slug = ((await res.json()).data ?? [])[0]?.slug as string;
      expect(slug).toBeTruthy();

      // Clicking the heart anonymously is the point, and the API refuses it
      // with a 401 that Chromium logs as a console error.
      allowed = [
        (entry) =>
          entry.kind === 'console.error' &&
          /status of 401/.test(entry.message) &&
          (entry.url ?? '').includes('/v1/wishlist'),
      ];
      await page.goto(`/${locale}/catalog/product/${slug}`);
      const heart = page.locator('wishlist-toggle button').first();
      await expect(heart).toBeVisible({ timeout: 60_000 });
      await heart.click();
      // Whatever the affordance is called, it must not have added anything:
      // the API refuses an anonymous wishlist write.
      const wishlist = await req.get(`${API_BASE}/v1/wishlist`);
      expect(wishlist.status(), 'the wishlist stays account-only').toBe(401);
    } finally {
      await req.dispose();
    }
  });
});

/**
 * Fills the inline delivery-address form with an address inside the active
 * fixture's own country, which is the one a domestic shipping zone covers
 * (see `fixtureShippableAddress`'s docblock for why an out-of-zone address
 * strands the flow at the delivery step).
 */
async function fillAddress(page: import('@playwright/test').Page): Promise<void> {
  const address = fixtureShippableAddress({ fullName: 'Guest Buyer' });
  const form = page.getByTestId('address-form');
  await form.getByTestId('address-field-fullName').fill(address.fullName);
  await form.getByTestId('address-field-phone').fill(address.phone);
  await form.getByTestId('address-field-addressLine1').fill(address.addressLine1);
  await form.getByTestId('address-field-city').fill(address.city);
  await form.getByTestId('address-field-postalCode').fill(address.postalCode);
  // The country field is a <select>, not a text input; the old TN literal
  // never surfaced this because the mismatch it produced (no delivery method
  // for the address) failed the flow one step earlier every time.
  await form.getByTestId('address-field-country').selectOption(address.country);
}
