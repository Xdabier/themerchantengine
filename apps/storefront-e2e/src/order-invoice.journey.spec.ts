import { expect, test } from '@playwright/test';

import {
  attachAuthToBrowser,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  seedOrderInStatus,
  signUpViaApi,
  type ConsoleBaseline,
  activeStoreConfigFixture,
  type StorefrontLocale,
} from './support';

/**
 * Plan M phase M4 - the order-detail page tells the truth about the invoice,
 * the payment and the delivery address.
 *
 * The invoice button used to be enabled from a status guess: `status` not
 * PENDING and not CANCELLED. That offered a download for a DELIVERED order that
 * has no invoice, and refused one for a CANCELLED order that does, because
 * cancelling after confirmation leaves the issued invoice in place (K12, prior
 * K7). It now follows `order.invoice`, and explains itself when there is none.
 *
 * The page also gained a payment row (K7), and renders the country as a
 * localized name rather than the stored ISO code (K8).
 *
 * Authed, so built tier only: WebKit on the Vite dev server blocks the layout
 * shell's boot cart fetch and trips the console baseline (plan E).
 */
const STOREFRONT_E2E_BUILT = process.env['STOREFRONT_E2E_BUILT'] === '1';

const SEED_PRODUCT_SLUG = 'fx-laptop-pro-16-studio';
const PASSWORD = 'E2ePassw0rd!';

/** `payment.cashOnDelivery`, verbatim from `apps/storefront/src/i18n`. */
const COD_COPY: Partial<Record<StorefrontLocale, string>> = {
  fr: 'Paiement à la livraison',
  en: 'Cash on delivery',
  ar: 'الدفع عند الاستلام',
};

/** The invoice button's accessible name in every locale. */
const INVOICE_BUTTON = /facture|invoice|الفاتورة/i;

/**
 * The country the seeded address carries, as a NAME in the reader's language.
 * The stored value is the ISO code, and reading that back on the page is the
 * defect (finding K8). Derived from the active fixture rather than stated, so
 * the spec follows the store the harness actually seeded (plan E2.6).
 */
function countryName(locale: StorefrontLocale): string {
  const code = activeStoreConfigFixture().identity.address.country;
  return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
}

function uniqueEmail(tag: string): string {
  return `e2e-invoice-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@invoice.test`;
}

describeEveryLocale('storefront order invoice and payment (plan M phase M4)', (locale) => {
  test.skip(!STOREFRONT_E2E_BUILT, 'authed journeys run in the built tier only');

  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`a confirmed order offers its invoice and names its payment (${locale})`, async ({
    page,
    request,
  }) => {
    const session = await signUpViaApi(request, {
      email: uniqueEmail('confirmed'),
      password: PASSWORD,
      firstName: 'Nadia',
      lastName: 'Trabelsi',
    });
    // CONFIRMED is the transition that issues the invoice.
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG, 'CONFIRMED');

    await attachAuthToBrowser(page, session);
    const route = `/${locale}/account/orders/${order.id}`;
    await page.goto(route);

    await expect(page.getByTestId('account-order-heading')).toContainText(order.orderNumber);

    // K7: the payment row exists and names a tender.
    await expect(page.getByTestId('account-order-payment')).toContainText(
      copyFor(COD_COPY, locale),
    );

    // K8: a localized country name, not the stored `TN`.
    await expect(page.locator('.address-block').first()).toContainText(countryName(locale));

    // K12: an invoice exists, so the button is live and nothing explains it away.
    const invoiceButton = page.getByRole('button', { name: INVOICE_BUTTON });
    await expect(invoiceButton).toBeEnabled();
    await expect(page.getByTestId('account-order-invoice-reason')).toHaveCount(0);

    // And it really is a PDF, not a link to an error page.
    const pdf = await page.request.get(`/api/v1/orders/${order.id}/invoice/pdf`, {
      headers: { 'Accept-Language': locale },
    });
    expect(pdf.status(), `invoice pdf: ${pdf.status()}`).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');

    await reloadAndAssertClean(page, route, baseline);
  });

  test(`a pending order disables the invoice and says why (${locale})`, async ({
    page,
    request,
  }) => {
    const session = await signUpViaApi(request, {
      email: uniqueEmail('pending'),
      password: PASSWORD,
      firstName: 'Slim',
      lastName: 'Gharbi',
    });
    // Placed and left alone: no confirmation, so no invoice.
    const order = await seedOrderInStatus(request, session, locale, SEED_PRODUCT_SLUG, 'PENDING');

    await attachAuthToBrowser(page, session);
    const route = `/${locale}/account/orders/${order.id}`;
    await page.goto(route);

    await expect(page.getByRole('button', { name: INVOICE_BUTTON })).toBeDisabled();
    // The defect was a disabled button with nothing said about it.
    await expect(page.getByTestId('account-order-invoice-reason')).toBeVisible();
    await expect(page.getByTestId('account-order-invoice-reason')).not.toBeEmpty();

    await reloadAndAssertClean(page, route, baseline);
  });
});
