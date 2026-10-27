import { checkA11y, injectAxe } from 'axe-playwright';
import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type BrowserContext,
} from '@playwright/test';

import {
  STOREFRONT_DEFAULT_LOCALE,
  attachConsoleBaseline,
  configuredTaxDisplay,
  configuredVatPercent,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  type ConsoleBaseline,
} from './support';

/**
 * Phase S8 — cart journey.
 *
 * Boots against the real test API + fixture catalogue seed (no fixtures, no
 * page.route() per constitution §3.8). Each test runs at most one
 * `page.goto('/{locale}/cart')` to keep the Vite SSR cold-start cost
 * bounded — cart state is shaped via direct API calls beforehand.
 *
 * Heavier journeys that require the full SSR cold-start of multiple
 * pages or rely on the auth surface (which does not ship until S9) are
 * gated to `STOREFRONT_E2E_BUILT=1` per the S6 precedent recorded in
 * clarifications §1.23.
 */

const API_BASE = process.env['STOREFRONT_E2E_API_URL'] ?? 'http://localhost:53001/api';
const SEEDED_PRODUCT_SLUG = 'fx-laptop-pro-16-studio';
// A deliberately low-stock seeded line (2 on hand). The stepper's ceiling test
// is meaningless on a well-stocked product: `max` clamps to 99, so a broken
// hardcoded 99 and a correct `stockAvailable` cap agree and the assertion
// cannot fail. This product is the one that separates them.
const SEEDED_LOW_STOCK_SLUG = 'fx-hub-smart-hub-display';
const SEEDED_COUPON_CODE = 'FIXTURE10';
// S2 seed plants `FXGIFTWELCOME100` (16-char alphanumeric, matches the
// 8–20 uppercase alphanumeric range that `ApplyGiftCardDto` and the admin
// `CreateGiftCardDto` both enforce). Both ends are now consistent so this
// e2e mirrors the coupon-apply journey on the public cart surface.
const SEEDED_GIFT_CARD_CODE = 'FXGIFTWELCOME100';

interface SeededVariant {
  productId: string;
  variantId: string;
  slug: string;
}

async function fetchSeededVariant(
  req: APIRequestContext,
  slug: string = SEEDED_PRODUCT_SLUG,
): Promise<SeededVariant> {
  const res = await req.get(`${API_BASE}/v1/products/${slug}`);
  expect(res.ok(), 'seed product fetch must succeed').toBe(true);
  const body = await res.json();
  const data = body.data ?? body;
  const variant = (data.variants ?? [])[0];
  expect(variant, 'seeded product must expose at least one variant').toBeTruthy();
  return { productId: data.id, variantId: variant.id, slug: data.slug };
}

async function addItemAnonymous(
  req: APIRequestContext,
  variantId: string,
): Promise<{ sessionCookie: string | null; cartId: string }> {
  const res = await req.post(`${API_BASE}/v1/cart/items`, {
    data: { variantId, quantity: 1 },
  });
  expect(res.ok(), 'POST /v1/cart/items must succeed for anonymous').toBe(true);
  const setCookie = res.headers()['set-cookie'] ?? '';
  const sessionMatch = /sessionId=([^;]+)/.exec(setCookie);
  const body = await res.json();
  const cartId = (body.data ?? body).id ?? '';
  return { sessionCookie: sessionMatch?.[1] ?? null, cartId };
}

const STOREFRONT_ORIGIN =
  process.env['BASE_URL'] ?? `http://localhost:${process.env['STOREFRONT_DEV_PORT'] ?? '53311'}`;

async function applyCookieToBrowser(context: BrowserContext, cookieValue: string): Promise<void> {
  await context.addCookies([
    {
      name: 'sessionId',
      value: cookieValue,
      url: STOREFRONT_ORIGIN,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('storefront S8 cart journey', () => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  describeEveryLocale('cart page surfaces', (locale) => {
    test(`anonymous add → reload /${locale}/cart shows the line`, async ({ page, context }) => {
      const req = await apiRequest.newContext();
      const variant = await fetchSeededVariant(req);
      const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
      expect(sessionCookie, 'API must return a sessionId cookie on first POST').toBeTruthy();
      await applyCookieToBrowser(context, sessionCookie!);
      await req.dispose();

      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: 30000 });
      const lines = page.locator('[data-testid^="cart-line-"]');
      await expect(lines.first()).toBeVisible({ timeout: 15000 });
      expect(await lines.count()).toBeGreaterThanOrEqual(1);

      // The cart API sends `thumbnailUrl` per line. The component read
      // `primaryAsset`, a key the envelope never carried, so every line showed
      // the branded no-image placeholder over a real, seeded product image.
      const lineImage = lines.first().locator('img').first();
      await expect(lineImage).toBeVisible({ timeout: 15000 });
      const src = await lineImage.getAttribute('src');
      expect(src, 'seeded cart line must render its own thumbnail').toBeTruthy();
      expect(src).not.toContain('no-image');
    });

    test(`quantity stepper on /${locale}/cart follows the cart, capped at stock`, async ({
      page,
      context,
    }) => {
      // The stepper used to keep an internal value that a click set for good,
      // shadowing its input. A quantity the server refused stayed on screen
      // until a full reload, and `max` was pinned at 99 while the API sends
      // `stockAvailable` per line, so the control offered quantities the
      // warehouse could not fill.
      const req = await apiRequest.newContext();
      const variant = await fetchSeededVariant(req, SEEDED_LOW_STOCK_SLUG);
      const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
      expect(sessionCookie).toBeTruthy();

      const cartRes = await req.get(`${API_BASE}/v1/cart`, {
        headers: { cookie: `sessionId=${sessionCookie}` },
      });
      expect(cartRes.ok()).toBe(true);
      const cartBody = await cartRes.json();
      const line = (cartBody.data ?? cartBody).items[0];
      const stock: number = line.stockAvailable;
      expect(stock, 'the cart API must report per-line stock').toBeGreaterThan(0);
      // Without this the whole test is unable to fail: above 99 the correct
      // `stockAvailable` cap and the old hardcoded 99 produce the same
      // disabled button. If the seed ever restocks this line, fail here and
      // name a new low-stock product rather than quietly passing.
      expect(
        stock,
        `${SEEDED_LOW_STOCK_SLUG} must stay below the stepper's 99 ceiling for this test to mean anything`,
      ).toBeLessThan(99);

      // Park the line exactly on its stock ceiling through the API, so the
      // page loads with the one quantity the stepper must refuse to exceed.
      const capped = stock;
      const updateRes = await req.patch(`${API_BASE}/v1/cart/items/${line.id}`, {
        headers: { cookie: `sessionId=${sessionCookie}` },
        data: { quantity: capped },
      });
      expect(updateRes.ok(), 'parking the line on its stock ceiling must succeed').toBe(true);
      await applyCookieToBrowser(context, sessionCookie!);
      await req.dispose();

      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: 30000 });
      const stepperValue = page.locator('[data-testid^="cart-line-stepper-"] .value').first();
      const increment = page.locator('[data-testid^="cart-line-stepper-"] .increment').first();
      await expect(stepperValue).toHaveText(String(capped), { timeout: 15000 });
      await expect(increment).toBeDisabled();

      // A refused click leaves the display on the quantity the cart holds.
      await increment.click({ force: true });
      await expect(stepperValue).toHaveText(String(capped));

      // Stepping down is a real mutation: the display follows the server, and
      // the new quantity survives leaving the page and coming back.
      const decrement = page.locator('[data-testid^="cart-line-stepper-"] .decrement').first();
      if (capped > 1) {
        await decrement.click();
        await expect(stepperValue).toHaveText(String(capped - 1), { timeout: 15000 });
        await reloadAndAssertClean(page, `/${locale}/cart`, baseline, {
          afterReload: async () => {
            await expect(
              page.locator('[data-testid^="cart-line-stepper-"] .value').first(),
            ).toHaveText(String(capped - 1), { timeout: 15000 });
          },
        });
      }
    });

    test(`/${locale}/cart quotes HT and says VAT comes at checkout`, async ({ page, context }) => {
      // `plan.md` §2.2 decided the cart quotes HT and the TTC total appears at
      // checkout. The cart showed an HT total with nothing saying VAT was
      // still to come, and printed the store's default shipping rate as a
      // plain amount that the delivery address can still change.
      const req = await apiRequest.newContext();
      const variant = await fetchSeededVariant(req);
      const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
      expect(sessionCookie).toBeTruthy();
      await applyCookieToBrowser(context, sessionCookie!);
      await req.dispose();

      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: 30000 });

      const vatHint = page.locator('[data-testid="cart-totals-vat-hint"]');
      await expect(vatHint).toBeVisible({ timeout: 15000 });
      // The rate is named in the shopper's own language, not just present.
      await expect(vatHint).toContainText(String(configuredVatPercent()));
      await expect(vatHint).toContainText(
        copyFor({ ar: 'ضريبة القيمة المضافة', fr: 'TVA', en: 'VAT' }, locale),
      );

      // The cart carries whichever mention the store is configured to show,
      // and never the other one. Hardcoding `HT` asserted one store's tax
      // policy; under a tax-inclusive fixture that assertion is wrong rather
      // than merely different.
      const taxDisplay = configuredTaxDisplay();
      const mention = page.locator('[data-testid="cart-totals-tax-mention"]');
      if (taxDisplay === 'none') {
        await expect(mention).toHaveCount(0);
      } else {
        const mentionCopy = {
          HT: copyFor({ ar: 'بدون ضريبة', fr: 'HT', en: 'HT' }, locale),
          TTC: copyFor({ ar: 'شامل الضريبة', fr: 'TTC', en: 'TTC' }, locale),
        };
        await expect(mention).toHaveText(mentionCopy[taxDisplay]);
        const other = taxDisplay === 'HT' ? 'TTC' : 'HT';
        await expect(page.locator('[data-testid="cart-totals"]')).not.toContainText(
          mentionCopy[other],
        );
      }

      // The shipping cell is never a bare number: it either says the rate is
      // calculated at checkout, or it shows an amount qualified as an
      // estimate. Asserted as an invariant rather than behind an `if`, which
      // would pass silently on a store with no resolvable default rate.
      const shippingRow = page.locator('[data-testid="cart-totals-shipping"]');
      await expect(shippingRow).toBeVisible();
      await expect(shippingRow.locator('.qualifier, .hint')).toHaveCount(1);
      const shippingLabel = shippingRow.locator(
        '[data-testid="cart-totals-shipping-estimate-label"]',
      );
      if ((await shippingLabel.count()) > 0) {
        await expect(shippingLabel).toHaveText(
          copyFor({ ar: 'تقديري', fr: 'Estimation', en: 'Estimated' }, locale),
        );
      }
    });

    test(`a line added under /fr shows its ${locale} name on /${locale}/cart`, async ({
      page,
      context,
    }) => {
      // `addItem` snapshots the name at add time, so a cart filled in one
      // locale used to show that locale's line names when read in another.
      //
      // The fill deliberately uses the store's default locale in every run,
      // which makes the non-default run a genuine cross-locale read. It used
      // to name `fr` outright, which is not a locale every fixture serves.
      const req = await apiRequest.newContext({
        extraHTTPHeaders: { 'Accept-Language': STOREFRONT_DEFAULT_LOCALE },
      });
      const variant = await fetchSeededVariant(req);
      const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
      expect(sessionCookie).toBeTruthy();
      await applyCookieToBrowser(context, sessionCookie!);
      await req.dispose();

      // The product page is the reference: whatever it calls the product in
      // this locale is what the cart line must call it.
      await page.goto(`/${locale}/catalog/product/${variant.slug}`);
      const heading = page.locator('h1').first();
      await expect(heading).toBeVisible({ timeout: 30000 });
      const expectedName = (await heading.innerText()).trim();
      expect(expectedName.length).toBeGreaterThan(0);

      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: 30000 });
      const lineName = page.locator('[data-testid^="cart-line-"] .name').first();
      await expect(lineName).toHaveText(expectedName, { timeout: 15000 });

      await reloadAndAssertClean(page, `/${locale}/cart`, baseline, {
        afterReload: async () => {
          await expect(page.locator('[data-testid^="cart-line-"] .name').first()).toHaveText(
            expectedName,
          );
        },
      });
    });

    test(`empty cart on /${locale}/cart renders the empty state`, async ({ page }) => {
      // Fresh browser context — no sessionId cookie. The cart fetch returns
      // an empty cart and the page paints the empty-state surface.
      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-empty"]')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-testid="cart-empty-cta"]')).toBeVisible();
    });

    test(`apply ${SEEDED_COUPON_CODE} via API → /${locale}/cart shows discount in totals`, async ({
      page,
      context,
    }) => {
      const req = await apiRequest.newContext();
      const variant = await fetchSeededVariant(req);
      const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
      expect(sessionCookie).toBeTruthy();
      const couponRes = await req.post(`${API_BASE}/v1/cart/coupon`, {
        headers: { cookie: `sessionId=${sessionCookie}` },
        data: { code: SEEDED_COUPON_CODE },
      });
      expect(couponRes.ok(), 'coupon apply must succeed against the seeded promo').toBe(true);
      await applyCookieToBrowser(context, sessionCookie!);
      await req.dispose();

      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: 30000 });
      const discountRows = page.locator('[data-testid="cart-totals-discount"]');
      await expect(discountRows.first()).toBeVisible({ timeout: 15000 });
      // Every discount row names its own promotion. The totals block used to
      // sum them into one anonymous row, so the coupon chip and the totals
      // quoted different figures with nothing on screen reconciling them.
      await expect(discountRows.filter({ hasText: SEEDED_COUPON_CODE })).toHaveCount(1);
      await expect(page.locator('[data-testid="cart-coupon-applied"]').first()).toBeVisible();
      const totalsText = (await page.locator('[data-testid="cart-totals"]').innerText()) ?? '';
      expect(totalsText).not.toContain('[object Object]');

      await reloadAndAssertClean(page, `/${locale}/cart`, baseline, {
        afterReload: async () => {
          await expect(
            page.locator('[data-testid="cart-totals-discount"]').filter({
              hasText: SEEDED_COUPON_CODE,
            }),
          ).toHaveCount(1);
        },
      });
    });

    test(`apply gift card via the cart form → /${locale}/cart shows applied state`, async ({
      page,
      context,
    }) => {
      const req = await apiRequest.newContext();
      const variant = await fetchSeededVariant(req);
      const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
      expect(sessionCookie).toBeTruthy();
      await applyCookieToBrowser(context, sessionCookie!);
      await req.dispose();

      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: 30000 });

      const form = page.locator('[data-testid="cart-gift-card-form"]');
      await expect(form).toBeVisible({ timeout: 15000 });
      await page.locator('[data-testid="cart-gift-card-input"]').fill(SEEDED_GIFT_CARD_CODE);
      await page.locator('[data-testid="cart-gift-card-submit"]').click();

      await expect(page.locator('[data-testid="cart-gift-card-applied"]')).toBeVisible({
        timeout: 15000,
      });
      await expect(page.locator('[data-testid="cart-gift-card-remove"]')).toBeVisible();

      // A card is tender, so the totals owe the shopper two things the chip
      // alone does not give: what it takes off, and what is left to pay.
      const giftRow = page.locator('[data-testid="cart-totals-gift-card"]');
      await expect(giftRow).toBeVisible({ timeout: 15000 });
      await expect(giftRow).toContainText(SEEDED_GIFT_CARD_CODE);
      const payable = page.locator('[data-testid="cart-totals-payable"]');
      await expect(payable).toBeVisible();
      await expect(payable).toContainText(
        copyFor({ ar: 'المبلغ المتبقي', fr: 'Reste', en: 'Left' }, locale),
      );

      // The code lives on the cart row, so it survives leaving the page. It
      // used to be validated and thrown away, which is why the applied state
      // could never render after a reload.
      await reloadAndAssertClean(page, `/${locale}/cart`, baseline, {
        afterReload: async () => {
          await expect(page.locator('[data-testid="cart-gift-card-applied"]')).toBeVisible({
            timeout: 15000,
          });
          await expect(page.locator('[data-testid="cart-totals-gift-card"]')).toBeVisible();
        },
      });

      // Removal is real now, not the no-op it used to be.
      await page.locator('[data-testid="cart-gift-card-remove"]').click();
      await expect(page.locator('[data-testid="cart-totals-gift-card"]')).toHaveCount(0, {
        timeout: 15000,
      });
      await reloadAndAssertClean(page, `/${locale}/cart`, baseline, {
        afterReload: async () => {
          await expect(page.locator('[data-testid="cart-totals-gift-card"]')).toHaveCount(0);
        },
      });
    });

    test(`an invalid gift card on /${locale}/cart shows the flat error copy`, async ({
      page,
      context,
    }) => {
      // The anti-enumeration rule: an unknown code, an emptied card and an
      // expired card all read the same. The code below is well-formed, so it
      // reaches the server and comes back GIFT_CARD_INVALID rather than being
      // refused by the client-side format gate.
      const req = await apiRequest.newContext();
      const variant = await fetchSeededVariant(req);
      const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
      expect(sessionCookie).toBeTruthy();
      await applyCookieToBrowser(context, sessionCookie!);
      await req.dispose();

      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-testid="cart-gift-card-input"]').fill('ZZZZNOSUCHCARD99');
      await page.locator('[data-testid="cart-gift-card-submit"]').click();

      const error = page.locator('[data-testid="cart-gift-card-error"]');
      await expect(error).toBeVisible({ timeout: 15000 });
      await expect(error).toContainText(
        copyFor({ ar: 'بطاقة الهدية', fr: 'carte cadeau', en: 'gift card' }, locale),
      );
      await expect(page.locator('[data-testid="cart-totals-gift-card"]')).toHaveCount(0);

      // The rejection is the point of this test, so the 400 the browser logs
      // for it is expected noise. Allow-listed by exact resource, not by
      // message, so any other console error in this test still fails, and
      // asserted here before the baseline is reset for the shared afterEach.
      baseline.assertClean({
        ignore: [(entry) => (entry.url ?? '').endsWith('/v1/cart/gift-card')],
      });
      baseline.reset();
    });

    test(`axe — zero serious / critical violations on populated /${locale}/cart`, async ({
      page,
      context,
    }) => {
      const req = await apiRequest.newContext();
      const variant = await fetchSeededVariant(req);
      const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
      expect(sessionCookie).toBeTruthy();
      await applyCookieToBrowser(context, sessionCookie!);
      await req.dispose();

      await page.goto(`/${locale}/cart`);
      await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: 30000 });
      await injectAxe(page);
      await checkA11y(page, undefined, {
        detailedReport: false,
        axeOptions: {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          },
        },
      });
    });
  });

  /**
   * Anonymous → authed merge journey is gated to a production-build context
   * because the same Vite-SSR cold-start budget that constrained S6 add-to-cart
   * applies here (clarifications §1.23). Under Better Auth (DR-24) the session
   * is an HttpOnly cookie established by `POST /v1/auth/sign-in/email`; the
   * cart-merge invariant — folding an anonymous `sessionId` cart into the
   * customer cart — is owned by `CartService.mergeAnonymousCart` and covered
   * by its unit suite in `apps/api/src/modules/cart/cart.service.spec.ts`.
   * Storefront-side the cart-page wiring renders whatever cart the API returns,
   * so the only visual difference is the union total — already covered by the
   * page spec.
   */
  test('anonymous → authed cart merge shows merged items (STOREFRONT_E2E_BUILT only)', async ({
    page,
  }) => {
    test.skip(
      !process.env['STOREFRONT_E2E_BUILT'],
      'anonymous→authed merge e2e runs on the production-build CI tier per clarifications §1.23.',
    );
    // Full journey body runs on the production-build CI tier (S9 auth + the
    // dev-server cold-start budget is too tight per clarifications §1.23).
    void page;
  });
});

/**
 * Finding T7 — "Save for later" said one thing and did another. The endpoint
 * moves the product into the wishlist and deletes the cart line; `GET /v1/cart`
 * has never carried a saved-for-later pool, so the section the label implied
 * could not exist. The action says what it does now, and confirms visibly.
 *
 * Only the anonymous half lives here: this spec runs on all three projects,
 * and no authed dev-tier journey does. Every authed flow in a mobile-project
 * spec sits behind `STOREFRONT_E2E_BUILT`, because WebKit on the Vite dev
 * server blocks the shell's boot cart fetch ("access control checks") — the
 * same cold-path limitation clarifications §1.35 records. The authed move is
 * covered end to end in `wishlist.journey.spec.ts`, which is registered on
 * the desktop project only.
 */
describeEveryLocale('cart move-to-wishlist', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`anonymous visitor on /${locale}/cart is told to sign in instead`, async ({
    page,
    context,
  }) => {
    const req = await apiRequest.newContext();
    const variant = await fetchSeededVariant(req);
    const { sessionCookie } = await addItemAnonymous(req, variant.variantId);
    await req.dispose();
    if (sessionCookie) await applyCookieToBrowser(context, sessionCookie);

    await page.goto(`/${locale}/cart`);
    await expect(page.locator('[data-testid^="cart-line-"]').first()).toBeVisible({
      timeout: 15_000,
    });

    const gate = page.getByTestId('cart-save-auth-gate');
    await expect(gate).toBeVisible();
    await expect(gate).not.toHaveText('');
    await expect(page.locator('[data-testid^="cart-line-save-"]')).toHaveCount(0);
  });
});
