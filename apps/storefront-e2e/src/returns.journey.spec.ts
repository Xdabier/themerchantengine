import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  attachAuthToBrowser,
  attachConsoleBaseline,
  authCookieHeader,
  describeEveryLocale,
  signUpViaApi,
  STOREFRONT_API_BASE,
  type AuthSession,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';

/**
 * Customer returns view journey — closes the back-to-back coverage gap
 * flagged by test-coverage-auditor 2026-05-14.
 *
 * `apps/admin-e2e/src/modules/returns.journey.spec.ts` covers admin
 * approve / reject / receive / refund. This spec covers the customer side:
 *
 *  1. anonymous → `/account/returns` redirects to `/auth/login` (the same
 *     account-guard contract every other `/account/*` route satisfies).
 *  2. authed customer with zero returns sees the empty state.
 *  3. authed customer with a return seeded via the API sees the row,
 *     the status badge, and a link back to the originating order.
 *
 * Per spec §4 line 95 the storefront is read-only "view your returns" in
 * v1. Submission is not exercised here — admin issues returns on behalf of
 * the customer via the admin dashboard, then the customer sees them here.
 *
 * Per constitution §3.8: no `page.route()`, no fixtures, no mocks — drives
 * the live storefront against the real test API on 53001 (or wherever
 * `STOREFRONT_E2E_API_PORT` moves it).
 *
 * hardening-waived: reloadAndAssertClean. The storefront half of returns is
 * read-only in v1, so the POSTs in this file are seeding (sign-up, order,
 * return-on-behalf) rather than a user mutation. There is no user-written
 * state whose persistence across a reload could regress. The locale matrix
 * and the console baseline both apply and are in force below.
 */

const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';
const SEED_PRODUCT_SLUG = 'fx-laptop-pro-16-studio';

async function register(req: APIRequestContext): Promise<AuthSession> {
  const email = `returns-journey-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fixture.test`;
  return signUpViaApi(req, {
    email,
    password: 'Fixture-Test-123!',
    firstName: 'Ret',
    lastName: 'Urns',
  });
}

function headers(auth: AuthSession, locale: StorefrontLocale): Record<string, string> {
  return {
    Cookie: authCookieHeader(auth),
    'X-Requested-With': 'XMLHttpRequest',
    'Accept-Language': locale,
  };
}

async function placeOrder(req: APIRequestContext, auth: AuthSession, locale: StorefrontLocale) {
  const h = headers(auth, locale);
  const me = await req.get(`${STOREFRONT_API_BASE}/v1/users/me`, { headers: h });
  expect(me.status()).toBe(200);
  const meBody = await me.json();
  const addrId = (meBody.data?.addresses ?? meBody.addresses)?.[0]?.id;
  if (!addrId) {
    const created = await req.post(`${STOREFRONT_API_BASE}/v1/users/me/addresses`, {
      headers: h,
      data: {
        fullName: 'Returns Customer',
        phone: '+97400000000',
        addressLine1: '123 Test St',
        city: 'Lyon',
        country: 'QA',
        isDefaultShipping: true,
      },
    });
    expect(created.ok(), `create address: ${await created.text()}`).toBe(true);
  }

  const product = await req.get(`${STOREFRONT_API_BASE}/v1/products/${SEED_PRODUCT_SLUG}`);
  const variantId = ((await product.json()).data ?? {}).variants?.[0]?.id;
  expect(variantId).toBeTruthy();

  await req.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
    headers: h,
    data: { variantId, quantity: 1 },
  });

  // `X-Idempotency-Key` is validated as a UUID v4, so an ad-hoc string is
  // refused with IDEMPOTENCY_KEY_MALFORMED before the handler ever runs.
  const idemKey = randomUUID();
  const meRefresh = await req.get(`${STOREFRONT_API_BASE}/v1/users/me`, { headers: h });
  const addressId = (await meRefresh.json()).data.addresses[0].id;
  const place = await req.post(`${STOREFRONT_API_BASE}/v1/orders`, {
    headers: { ...h, 'X-Idempotency-Key': idemKey },
    data: { shippingAddressId: addressId },
  });
  expect(place.status(), `place order: ${await place.text()}`).toBe(201);
  const order = (await place.json()).data;
  return order as { id: string; items: Array<{ id: string }> };
}

describeEveryLocale('storefront returns view journey', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`anonymous /${locale}/account/returns redirects to /auth/login with from=...`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/account/returns`);
    await page.waitForURL(
      (url) => url.pathname === `/${locale}/auth/login` && url.searchParams.has('from'),
      { timeout: 15_000 },
    );
    const url = new URL(page.url());
    expect(url.searchParams.get('from')).toBe(`/${locale}/account/returns`);
  });

  test(`SSR shell renders /${locale}/account/returns without crashing`, async ({ page }) => {
    const response = await page.goto(`/${locale}/account/returns`);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByTestId('account-returns-page')).toBeVisible();
  });

  test(`authed customer with zero returns sees the empty state (${locale})`, async ({
    page,
    request,
  }) => {
    test.skip(
      !STOREFRONT_E2E_BUILT,
      'Vite SSR cold-start budget — runs on the production-build CI tier per clarifications §1.23.',
    );
    const auth = await register(request);
    await attachAuthToBrowser(page, auth);
    await page.goto(`/${locale}/account/returns`);
    await expect(page.getByTestId('account-returns-page')).toBeVisible();
    await expect(page.getByTestId('account-returns-empty')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('account-returns-empty-cta')).toBeVisible();
  });

  test(`authed customer with a return sees the row + status + order link (${locale})`, async ({
    page,
    request,
  }) => {
    test.skip(
      !STOREFRONT_E2E_BUILT,
      'Vite SSR cold-start budget — runs on the production-build CI tier per clarifications §1.23.',
    );

    const auth = await register(request);
    const order = await placeOrder(request, auth, locale);

    const orderItemId = order.items?.[0]?.id;
    expect(orderItemId, 'order must expose at least one item id').toBeTruthy();

    const created = await request.post(`${STOREFRONT_API_BASE}/v1/orders/${order.id}/returns`, {
      headers: headers(auth, locale),
      data: {
        items: [{ orderItemId, quantity: 1 }],
        reason: 'CHANGED_MIND',
        reasonDetail: 'e2e seed',
      },
    });
    expect(created.ok(), `create return: ${await created.text()}`).toBe(true);
    const returnId = (await created.json()).data.id as string;

    await attachAuthToBrowser(page, auth);
    await page.goto(`/${locale}/account/returns`);
    await expect(page.getByTestId('account-returns-page')).toBeVisible();
    await expect(page.getByTestId(`account-return-row-${returnId}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`account-return-status-${returnId}`)).toContainText(/.+/);
    await expect(page.getByTestId(`account-return-order-link-${returnId}`)).toHaveAttribute(
      'href',
      new RegExp(`/${locale}/account/orders/${order.id}$`),
    );
  });
});
