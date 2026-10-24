import { expect, test } from '@playwright/test';

import {
  apiHeaders,
  attachAuthToBrowser,
  attachConsoleBaseline,
  describeEveryLocale,
  reloadAndAssertClean,
  seedOrderInStatus,
  signInAsAdmin,
  signUpViaApi,
  STOREFRONT_API_BASE,
  waitForHydration,
  type AssertCleanOptions,
  type ConsoleBaseline,
  type SeededOrder,
  type StorefrontLocale,
} from './support';

/**
 * The public order-track page, at `/{locale}/track` (findings N3, K9, K10, K11).
 *
 * The page is deliberately public (`POST /v1/orders/track` is `@Public()` behind
 * an email challenge), so a customer who has lost their session can still follow
 * an order with the number on their confirmation.
 *
 * It used to live under `/account/orders/:id/track`, keyed by the order's
 * internal id, which it then showed the customer as their "order number". Both
 * halves of the challenge are typed in now, and they travel in a POST body: the
 * assertions below include a network check that no request URL ever carries the
 * email.
 *
 * Runs in a context with no session cookies: the whole point of the page is
 * that it works without one.
 */
const SEED_PRODUCT_SLUG = 'fx-laptop-pro-16-studio';
const PASSWORD = 'E2ePassw0rd!';

function uniqueEmail(tag: string): string {
  return `e2e-track-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@track.test`;
}

/**
 * Every request URL the page issued, so a journey can prove the email never
 * reached one (finding K10).
 */
function recordRequestUrls(page: import('@playwright/test').Page): string[] {
  const urls: string[] = [];
  page.on('request', (req) => urls.push(req.url()));
  return urls;
}

/**
 * Walking an order to DELIVERED through the admin status endpoint creates no
 * Shipment row: shipments only exist once someone posts one. The journey has to
 * create one and mark it delivered for there to be a shipments list to assert.
 */
async function shipAndDeliver(
  request: import('@playwright/test').APIRequestContext,
  locale: StorefrontLocale,
  order: SeededOrder,
): Promise<void> {
  const adminAuth = await signInAsAdmin(request);
  const headers = apiHeaders(adminAuth, locale);

  const created = await request.post(
    `${STOREFRONT_API_BASE}/v1/admin/orders/${order.id}/shipments`,
    {
      headers,
      data: {
        carrier: 'Aramex',
        trackingNumber: `ARX-${Date.now()}`,
        items: order.items.map((item) => ({ orderItemId: item.id, quantity: 1 })),
      },
    },
  );
  expect(created.status(), `create shipment: ${await created.text()}`).toBe(201);
  const shipmentId = (await created.json()).data.id as string;

  for (const status of ['SHIPPED', 'DELIVERED'] as const) {
    const patched = await request.patch(
      `${STOREFRONT_API_BASE}/v1/admin/orders/${order.id}/shipments/${shipmentId}`,
      { headers, data: { status } },
    );
    expect(patched.status(), `shipment to ${status}: ${await patched.text()}`).toBe(200);
  }
}

describeEveryLocale('storefront order-track journey (findings N3, K9, K10, K11)', (locale) => {
  let baseline: ConsoleBaseline;
  /**
   * The wrong-email journey drives the lookup into a deliberate 404, and
   * Chromium logs every failed request as a console error. Scoped per test so
   * the happy path stays strict.
   */
  let allowed: NonNullable<AssertCleanOptions['ignore']> = [];
  test.beforeEach(({ page }) => {
    allowed = [];
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean({ ignore: allowed });
  });

  test(`the owner's email reveals the order status and its shipments (${locale})`, async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('owner');
    const session = await signUpViaApi(request, {
      email,
      password: PASSWORD,
      firstName: 'Ines',
      lastName: 'Mejri',
    });
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG);
    await shipAndDeliver(request, locale, order);

    const route = `/${locale}/track`;
    const requestUrls = recordRequestUrls(page);
    await page.goto(route);
    // Hydration barrier: the form is inert until the browser bundle runs, and
    // `toBeVisible` is satisfied by the SSR markup, so it could never catch
    // the case it was written for. A `fill` before hydration sets the DOM value
    // and not the reactive control, and hydration then clears the input.
    await waitForHydration(page);
    await expect(page.getByTestId('track-order-number-input')).toBeVisible();

    await page.getByTestId('track-order-number-input').fill(order.orderNumber);
    await page.getByTestId('track-email-input').fill(email);
    await page.getByTestId('track-submit').click();

    await expect(page.getByTestId('track-result')).toBeVisible();
    await expect(page.getByTestId('track-result')).toContainText(order.orderNumber);
    // The shipment above is the only reason there is anything to render here:
    // the status walk alone creates none.
    await expect(page.getByTestId('track-shipment').first()).toBeVisible();
    await expect(page.getByTestId('track-no-shipments')).toHaveCount(0);
    await expect(page.locator('app-order-status-timeline')).toBeVisible();
    // The timeline is the API's now, not one derived from shipment stamps, so
    // it carries the pre-shipment hops too (finding K11).
    await expect(page.locator('app-order-status-timeline li')).not.toHaveCount(0);

    // Finding K10: the email is the credential, and it must never reach a URL.
    expect(requestUrls.filter((u) => u.includes('email=') || u.includes(email))).toEqual([]);

    await reloadAndAssertClean(page, route, baseline);
  });

  test(`a wrong email shows the generic not-found copy (${locale})`, async ({ page, request }) => {
    const session = await signUpViaApi(request, {
      email: uniqueEmail('wrong'),
      password: PASSWORD,
      firstName: 'Karim',
      lastName: 'Sassi',
    });
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG);

    const route = `/${locale}/track`;
    await page.goto(route);
    await waitForHydration(page);
    await expect(page.getByTestId('track-order-number-input')).toBeVisible();

    // The refusal is a 404 by design: a distinguishable answer would let
    // anyone holding an order number enumerate the email that placed it.
    allowed = [
      (entry) =>
        entry.kind === 'console.error' &&
        /status of 404/.test(entry.message) &&
        (entry.url ?? '').includes('/v1/orders/track'),
    ];
    await page.getByTestId('track-order-number-input').fill(order.orderNumber);
    await page.getByTestId('track-email-input').fill('not-the-owner@track.test');
    await page.getByTestId('track-submit').click();

    // Deliberately generic: a distinguishable answer would let anyone with an
    // order number enumerate the email that placed it.
    await expect(page.getByTestId('track-not-found')).toBeVisible();
    await expect(page.getByTestId('track-result')).toHaveCount(0);

    await reloadAndAssertClean(page, route, baseline, { ignore: allowed });
  });

  test(`the confirmation page links here by order number (${locale})`, async ({
    page,
    request,
  }) => {
    const session = await signUpViaApi(request, {
      email: uniqueEmail('link'),
      password: PASSWORD,
      firstName: 'Sonia',
      lastName: 'Ayari',
    });
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG);

    await attachAuthToBrowser(page, session);
    await page.goto(`/${locale}/order-confirmation/${order.orderNumber}`);

    const link = page.getByTestId('order-confirmation-public-track');
    await expect(link).toHaveAttribute('href', `/${locale}/track?order=${order.orderNumber}`);
    await link.click();
    await page.waitForURL(`**/${locale}/track?order=${order.orderNumber}`);
    await expect(page.getByTestId('track-form')).toBeVisible();
    // The number is prefilled; the email still has to be answered.
    await expect(page.getByTestId('track-order-number-input')).toHaveValue(order.orderNumber);
  });
});
