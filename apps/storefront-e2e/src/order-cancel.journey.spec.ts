import { expect, test } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  apiHeaders,
  attachAuthToBrowser,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  seedOrderInStatus,
  signInAsAdmin,
  signUpViaApi,
  type AssertCleanOptions,
  type ConsoleBaseline,
  type ConsoleBaselineEntry,
  type StorefrontLocale,
} from './support';

/**
 * Finding AD4 - the customer cancel button and the shipment state agree.
 *
 * Before plan M phase M1 the page kept its own status allowlist, wider than the
 * API rule, so a customer whose order was already being prepared was offered a
 * cancel button and got a bare 409 on click. The order detail now reads the
 * server's `cancellable` flag, and the refusal names its reason so the copy can
 * tell the customer what to do next.
 *
 * Authed, so built tier only: WebKit on the Vite dev server blocks the layout
 * shell's boot cart fetch and trips the console baseline (plan E).
 */
const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';

const SEED_PRODUCT_SLUG = 'fx-laptop-pro-16-studio';
const PASSWORD = 'E2ePassw0rd!';

/** The `cancel.hasShipment` copy, verbatim from `apps/storefront/src/i18n`. */
const HAS_SHIPMENT_COPY: Partial<Record<StorefrontLocale, string>> = {
  fr: 'Votre commande est déjà en préparation',
  en: 'Your order is already being prepared',
  ar: 'طلبك قيد التحضير ولم يعد بالإمكان إلغاؤه عبر الموقع. تواصل معنا لتعديله.',
};

/** The PENDING status badge, verbatim from `apps/storefront/src/i18n`. */
const TIMELINE_PLACED: Partial<Record<StorefrontLocale, string>> = {
  fr: 'En attente',
  en: 'Pending',
  ar: 'قيد الانتظار',
};

/** The `cancel.cta` label, verbatim from `apps/storefront/src/i18n`. */
const CANCEL_CTA: Partial<Record<StorefrontLocale, RegExp>> = {
  fr: /Annuler la commande/i,
  en: /Cancel order/i,
  ar: /إلغاء الطلب/i,
};

/**
 * The one deliberate failure in this file: the race test clicks a cancel button
 * the server has just started refusing. Matched on the entry rather than on a
 * message RegExp, because "Failed to load resource" is the same text a broken
 * image emits and a substring rule would hide those too.
 */
function expectedCancelConflict(orderId: string) {
  return (entry: ConsoleBaselineEntry): boolean =>
    entry.kind === 'console.error' &&
    /status of 409/.test(entry.message) &&
    (entry.url ?? '').endsWith(`/v1/orders/${orderId}/cancel`);
}

function uniqueEmail(tag: string): string {
  return `e2e-cancel-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@cancel.test`;
}

describeEveryLocale('storefront order cancel seam (finding AD4)', (locale) => {
  let baseline: ConsoleBaseline;
  /**
   * The race test drives the cancel endpoint into a deliberate 409, and
   * Chromium logs every failed request as a console error. Scoped per test so
   * the two happy paths stay strict.
   */
  let allowed: NonNullable<AssertCleanOptions['ignore']> = [];
  test.beforeEach(({ page }) => {
    allowed = [];
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean({ ignore: allowed });
  });

  test(`a CONFIRMED order offers the cancel button (${locale})`, async ({ page, request }) => {
    test.skip(!STOREFRONT_E2E_BUILT, 'authed flow, built tier only');

    const email = uniqueEmail('open');
    const session = await signUpViaApi(request, {
      email,
      password: PASSWORD,
      firstName: 'Nour',
      lastName: 'Ben Salah',
    });
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG, 'CONFIRMED');
    await attachAuthToBrowser(page, session);

    const route = `/${locale}/account/orders/${order.id}`;
    await page.goto(route);

    await expect(page.getByRole('button', { name: copyFor(CANCEL_CTA, locale) })).toBeVisible();

    await reloadAndAssertClean(page, route, baseline);
    await expect(page.getByRole('button', { name: copyFor(CANCEL_CTA, locale) })).toBeVisible();
  });

  test(`the timeline lists every transition with its own time (${locale})`, async ({
    page,
    request,
  }) => {
    test.skip(!STOREFRONT_E2E_BUILT, 'authed flow, built tier only');

    // Finding AD6. The page used to render one row stamped with the time the
    // order was placed, whatever had happened to it since.
    const email = uniqueEmail('timeline');
    const session = await signUpViaApi(request, {
      email,
      password: PASSWORD,
      firstName: 'Sami',
      lastName: 'Khelifi',
    });
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG, 'CONFIRMED');
    await attachAuthToBrowser(page, session);

    const route = `/${locale}/account/orders/${order.id}`;
    await page.goto(route);

    const rows = page.locator('[data-testid="order-status-timeline"] li');
    await expect(rows).toHaveCount(2);

    const stamps = await rows
      .locator('time')
      .evaluateAll((nodes) => (nodes as HTMLTimeElement[]).map((n) => n.getAttribute('datetime')));
    expect(new Set(stamps).size).toBe(2);

    // The badges are localized, so this is also the both-locales assertion.
    await expect(rows.first()).toContainText(copyFor(TIMELINE_PLACED, locale));

    await reloadAndAssertClean(page, route, baseline);
    await expect(rows).toHaveCount(2);
  });

  test(`a shipment removes the button and explains why (${locale})`, async ({ page, request }) => {
    test.skip(!STOREFRONT_E2E_BUILT, 'authed flow, built tier only');

    const email = uniqueEmail('shipped');
    const session = await signUpViaApi(request, {
      email,
      password: PASSWORD,
      firstName: 'Hedi',
      lastName: 'Trabelsi',
    });
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG, 'CONFIRMED');

    // The warehouse starts work. This is what the customer must not be able to
    // undo online, and it is also what moves the order to PROCESSING.
    const adminAuth = await signInAsAdmin(request);
    const adminHeaders = apiHeaders(adminAuth, locale);
    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/orders/${order.id}/shipments`,
      {
        headers: adminHeaders,
        data: {
          carrier: 'Aramex',
          trackingNumber: `ARX-CANCEL-${Date.now()}`,
          items: order.items.map((item) => ({ orderItemId: item.id, quantity: 1 })),
        },
      },
    );
    expect(created.status(), `create shipment: ${await created.text()}`).toBe(201);

    await attachAuthToBrowser(page, session);
    const route = `/${locale}/account/orders/${order.id}`;
    await page.goto(route);

    await expect(page.getByTestId('account-order-detail-page')).toBeVisible();
    await expect(page.getByRole('button', { name: copyFor(CANCEL_CTA, locale) })).toHaveCount(0);

    // The endpoint refuses it too, in the localized words the page would show.
    const refused = await request.post(`${STOREFRONT_API_BASE}/v1/orders/${order.id}/cancel`, {
      headers: apiHeaders(session, locale),
    });
    expect(refused.status()).toBe(409);
    const body = await refused.json();
    expect(body.error.code).toBe('ORDER_CANCEL_INELIGIBLE');
    expect(body.error.details.reason).toBe('HAS_SHIPMENT');

    await reloadAndAssertClean(page, route, baseline);
    await expect(page.getByRole('button', { name: copyFor(CANCEL_CTA, locale) })).toHaveCount(0);
  });

  test(`the refusal copy is localized when the button is raced (${locale})`, async ({
    page,
    request,
  }) => {
    test.skip(!STOREFRONT_E2E_BUILT, 'authed flow, built tier only');

    // The realistic race: the page loaded while the order was still
    // cancellable, and the warehouse created a shipment before the click.
    const email = uniqueEmail('race');
    const session = await signUpViaApi(request, {
      email,
      password: PASSWORD,
      firstName: 'Rania',
      lastName: 'Gharbi',
    });
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG, 'CONFIRMED');
    // The 409 below is the point of the test, not a defect.
    allowed = [expectedCancelConflict(order.id)];
    await attachAuthToBrowser(page, session);

    const route = `/${locale}/account/orders/${order.id}`;
    await page.goto(route);
    await expect(page.getByRole('button', { name: copyFor(CANCEL_CTA, locale) })).toBeVisible();

    const adminAuth = await signInAsAdmin(request);
    const created = await request.post(
      `${STOREFRONT_API_BASE}/v1/admin/orders/${order.id}/shipments`,
      {
        headers: apiHeaders(adminAuth, locale),
        data: {
          carrier: 'Aramex',
          trackingNumber: `ARX-RACE-${Date.now()}`,
          items: order.items.map((item) => ({ orderItemId: item.id, quantity: 1 })),
        },
      },
    );
    expect(created.status(), `create shipment: ${await created.text()}`).toBe(201);

    await page.getByRole('button', { name: copyFor(CANCEL_CTA, locale) }).click();
    await page.getByTestId('account-order-cancel-confirm').waitFor();
    await page.getByTestId('account-order-cancel-confirm').getByRole('button').last().click();

    const error = page.getByTestId('account-order-cancel-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(copyFor(HAS_SHIPMENT_COPY, locale));

    // After the reload the page reads the fresh flag and stops offering it.
    // The helper re-asserts the baseline, which still holds the 409 above.
    await reloadAndAssertClean(page, route, baseline, { ignore: allowed });
    await expect(page.getByRole('button', { name: copyFor(CANCEL_CTA, locale) })).toHaveCount(0);
  });
});
