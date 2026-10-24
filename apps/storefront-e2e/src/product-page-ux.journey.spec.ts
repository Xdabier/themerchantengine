import { checkA11y, injectAxe } from 'axe-playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  STOREFRONT_API_BASE,
  attachAuthToBrowser,
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  signUpViaApi,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';

/**
 * Plan N: product page UX.
 *
 * Owns the surfaces the brand floor says carry the brand more than any other
 * (§9): the gallery, the buy box, and what the page offers when a product
 * cannot be bought. Real API, real seed, no `page.route()` and no fixtures per
 * constitution §3.8.
 *
 * N2 (finding P1, operator requirement #10): the main image opens a fullscreen
 * lightbox. The unit spec proves the DOM contract under jsdom, which implements
 * none of `<dialog>`'s behaviour; this spec is where the native modal path is
 * actually exercised: top-layer rendering, the Esc default, and focus coming
 * back to the trigger.
 */

const PRODUCT_SUMMARY = '[data-testid="product-summary"]';
const GALLERY = 'product-gallery';
const ZOOM = `${GALLERY} .zoom`;
const LIGHTBOX = `${GALLERY} dialog.lightbox`;

/** `product.gallery.*` in `apps/storefront/src/i18n/{fr,en}.ts`. Duplicated
 * rather than imported: `apps/storefront-e2e` compiles standalone and no spec
 * in this suite reaches into the storefront source tree. */
const GALLERY_LABELS: Partial<
  Record<
    StorefrontLocale,
    { open: string; close: string; next: string; previous: string; counter: string }
  >
> = {
  fr: {
    open: "Voir l'image en plein écran",
    close: 'Fermer le plein écran',
    next: 'Photo suivante',
    previous: 'Photo précédente',
    counter: 'Photo {position} sur {total}',
  },
  en: {
    open: 'View image fullscreen',
    close: 'Close fullscreen',
    next: 'Next image',
    previous: 'Previous image',
    counter: 'Image {position} of {total}',
  },
  ar: {
    open: 'عرض الصورة بملء الشاشة',
    close: 'إغلاق ملء الشاشة',
    next: 'الصورة التالية',
    previous: 'الصورة السابقة',
    counter: 'الصورة {position} من {total}',
  },
};

/** `product.*` in `apps/storefront/src/i18n/{fr,en}.ts`, duplicated for the
 * same reason `GALLERY_LABELS` is. */
const BUY_BOX_LABELS: Partial<
  Record<
    StorefrontLocale,
    { addToCart: string; increase: string; addedWithCount: string; viewCart: string; short: string }
  >
> = {
  fr: {
    addToCart: 'Ajouter au panier',
    increase: 'Augmenter la quantité',
    addedWithCount: '{count} ajouté(s) à votre panier.',
    viewCart: 'Voir le panier',
    short: 'Stock insuffisant pour cette quantité.',
  },
  en: {
    addToCart: 'Add to cart',
    increase: 'Increase quantity',
    addedWithCount: '{count} added to your cart.',
    viewCart: 'View cart',
    short: 'Not enough stock available for that quantity.',
  },
  ar: {
    addToCart: 'أضف إلى السلة',
    increase: 'زيادة الكمية',
    addedWithCount: 'تمت إضافة {count} إلى سلتك.',
    viewCart: 'عرض السلة',
    short: 'الكمية المطلوبة غير متوفرة في المخزون.',
  },
};

/** `product.backInStock.*` in `apps/storefront/src/i18n/{fr,en}.ts`. */
const NOTIFY_LABELS: Partial<
  Record<
    StorefrontLocale,
    { notify: string; stop: string; added: string; hint: string; preferences: string }
  >
> = {
  fr: {
    notify: 'Prévenez-moi du retour en stock',
    stop: 'Ne plus me prévenir',
    added: 'Nous vous enverrons un e-mail dès le retour en stock.',
    hint: 'Activez les rappels utiles pour la recevoir.',
    preferences: 'Préférences e-mail',
  },
  en: {
    notify: 'Notify me when it is back',
    stop: 'Stop notifying me',
    added: 'We will email you when it is back in stock.',
    hint: 'Turn on Helpful reminders to receive it.',
    preferences: 'Email preferences',
  },
  ar: {
    notify: 'أعلمني عند التوفر',
    stop: 'أوقف الإشعارات',
    added: 'سنراسلك عبر البريد الإلكتروني عند توفر المنتج.',
    hint: 'فعّل التذكيرات المفيدة لاستلامه.',
    preferences: 'تفضيلات البريد',
  },
};

const QUANTITY = '[data-testid="product-quantity"]';
const ADD_TO_CART = '[data-testid="product-add-to-cart"]';
const ADD_STATUS = '[data-testid="product-add-to-cart-status"]';
const ADD_ERROR = '[data-testid="product-add-to-cart-error"]';
const CART_BADGE = '[data-testid="header-cart-badge"]';
const WISHLIST_TOGGLE = `${PRODUCT_SUMMARY} wishlist-toggle button`;
// Every call site below scopes WISHLIST_LABEL to PRODUCT_SUMMARY itself.
const WISHLIST_LABEL = '[data-testid="wishlist-toggle-label"]';
// WISHLIST_STATUS is scoped here rather than at each call site:
// `wishlist-toggle` is the same reusable component every product card on the
// page renders (related rails included), so an unscoped testid matches one
// status span per card and trips Playwright's strict-mode violation the
// moment the page shows more than one card.
const WISHLIST_STATUS = `${PRODUCT_SUMMARY} [data-testid="wishlist-toggle-status"]`;
const BACK_IN_STOCK_HINT = '[data-testid="product-back-in-stock-hint"]';

/** `PAGE_SIZE` in `apps/storefront/src/app/pages/[locale]/catalog/index.page.ts`. */
const CATALOG_PAGE_SIZE = 24;
const MAX_CATALOGUE_PAGES = 6;
/** Vite SSR cold-start budget, matching the other multi-step journeys here. */
const FIRST_PAINT = 30_000;

function counterText(locale: StorefrontLocale, position: number, total: number): string {
  return copyFor(GALLERY_LABELS, locale)
    .counter.replace('{position}', String(position))
    .replace('{total}', String(total));
}

/**
 * Finds a seeded product carrying at least two gallery images.
 *
 * Discovered from the live API rather than hardcoded: the e2e database seeds
 * itself and the dev repro slugs named in the plan do not exist there. The
 * detail endpoint is the only place the gallery array lands, so this walks the
 * catalogue listing and asks the detail endpoint per candidate, stopping at the
 * first match.
 */
async function findMultiImageProduct(
  request: APIRequestContext,
  locale: StorefrontLocale,
): Promise<{ slug: string; imageCount: number }> {
  const headers = { 'Accept-Language': locale };
  let page = 1;
  let totalPages = 1;

  do {
    const res = await request.get(
      `${STOREFRONT_API_BASE}/v1/products?page=${page}&pageSize=${CATALOG_PAGE_SIZE}`,
      { headers },
    );
    expect(res.status(), 'GET /v1/products must answer 200 for the seeded catalogue').toBe(200);
    const body = (await res.json()) as { data?: unknown; meta?: { totalPages?: unknown } };
    totalPages = Number(body.meta?.totalPages ?? 1);
    const rows: unknown[] = Array.isArray(body.data) ? body.data : [];

    for (const row of rows) {
      const slug = (row as { slug?: unknown }).slug;
      if (typeof slug !== 'string') continue;
      const detail = await request.get(`${STOREFRONT_API_BASE}/v1/products/${slug}`, { headers });
      if (detail.status() !== 200) continue;
      const payload = (await detail.json()) as { data?: { images?: unknown; assets?: unknown } };
      const images = payload.data?.images ?? payload.data?.assets;
      const count = Array.isArray(images) ? images.length : 0;
      if (count > 1) return { slug, imageCount: count };
    }
    page += 1;
  } while (page <= totalPages && page <= MAX_CATALOGUE_PAGES);

  throw new Error(
    'the seeded catalogue must contain at least one product with two or more gallery images ' +
      'so the lightbox counter and its step controls can be proven',
  );
}

/**
 * First seeded product whose variants are all in stock, so the buy box is
 * usable and the quantity cap is the cart's 99 rather than a stock refusal.
 */
async function findInStockProduct(
  request: APIRequestContext,
  locale: StorefrontLocale,
): Promise<string> {
  const res = await request.get(
    `${STOREFRONT_API_BASE}/v1/products?page=1&pageSize=${CATALOG_PAGE_SIZE}`,
    { headers: { 'Accept-Language': locale } },
  );
  expect(res.status(), 'GET /v1/products must answer 200 for the seeded catalogue').toBe(200);
  const body = (await res.json()) as { data?: unknown };
  const rows: unknown[] = Array.isArray(body.data) ? body.data : [];

  for (const row of rows) {
    const product = row as { slug?: unknown; variants?: unknown };
    if (typeof product.slug !== 'string') continue;
    const variants: unknown[] = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length === 0) continue;
    const allInStock = variants.every(
      (variant) => (variant as { availability?: unknown }).availability === 'IN_STOCK',
    );
    if (allInStock) return product.slug;
  }
  throw new Error('the seeded catalogue must contain a fully in-stock product for the buy box');
}

/** First seeded product whose variants are all out of stock. */
async function findOutOfStockProduct(
  request: APIRequestContext,
  locale: StorefrontLocale,
): Promise<{ id: string; slug: string }> {
  const res = await request.get(`${STOREFRONT_API_BASE}/v1/products?page=1&pageSize=100`, {
    headers: { 'Accept-Language': locale },
  });
  expect(res.status(), 'GET /v1/products must answer 200 for the seeded catalogue').toBe(200);
  const body = (await res.json()) as { data?: unknown };
  const rows: unknown[] = Array.isArray(body.data) ? body.data : [];

  for (const row of rows) {
    const product = row as { id?: unknown; slug?: unknown; variants?: unknown };
    if (typeof product.slug !== 'string' || typeof product.id !== 'string') continue;
    const variants: unknown[] = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length === 0) continue;
    const allOut = variants.every(
      (variant) => (variant as { availability?: unknown }).availability === 'OUT_OF_STOCK',
    );
    if (allOut) return { id: product.id, slug: product.slug };
  }
  throw new Error(
    'the seeded catalogue must contain a fully out-of-stock product so the notify control ' +
      'has somewhere to render',
  );
}

async function openLightbox(page: Page, locale: StorefrontLocale): Promise<void> {
  const zoom = page.locator(ZOOM);
  await expect(zoom).toHaveAttribute('aria-label', copyFor(GALLERY_LABELS, locale).open, {
    timeout: FIRST_PAINT,
  });
  await zoom.click();
  await expect(page.locator(LIGHTBOX)).toBeVisible({ timeout: FIRST_PAINT });
}

describeEveryLocale('storefront N2 product gallery lightbox', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`the main image opens fullscreen, steps, and closes back to its trigger (${locale})`, async ({
    page,
    request,
  }) => {
    const product = await findMultiImageProduct(request, locale);
    const route = `/${locale}/catalog/product/${product.slug}`;

    await page.goto(route);
    await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });

    // Closed on first paint: the SSR byte stream must not carry an open dialog.
    await expect(page.locator(LIGHTBOX)).toHaveCount(0);

    await openLightbox(page, locale);
    const dialog = page.locator(LIGHTBOX);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(
      dialog.getByRole('button', { name: copyFor(GALLERY_LABELS, locale).close }),
    ).toBeVisible();
    await expect(dialog.locator('.counter')).toHaveText(counterText(locale, 1, product.imageCount));
    // The lightbox must show the large variant at full width, not the
    // thumbnail-sized source the strip below the main image uses.
    await expect(dialog.locator('img')).toHaveAttribute('sizes', '100vw');

    // Native modality. `:modal` matches only a dialog opened through
    // `showModal()`, which is what puts it in the top layer and makes the rest
    // of the document inert; an `open` attribute alone does not match. Asserted
    // on the real element rather than on geometry, because the summary behind
    // the scrim is still geometrically on screen.
    expect(
      await page.locator(LIGHTBOX).evaluate((el) => el.matches(':modal')),
      'the lightbox must be opened as a native modal, not just given an open attribute',
    ).toBe(true);

    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('.counter')).toHaveText(counterText(locale, 2, product.imageCount));

    await dialog.getByRole('button', { name: copyFor(GALLERY_LABELS, locale).previous }).click();
    await expect(dialog.locator('.counter')).toHaveText(counterText(locale, 1, product.imageCount));

    await injectAxe(page);
    await checkA11y(page, undefined, {
      axeOptions: {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      },
      detailedReport: false,
      includedImpacts: ['serious', 'critical'],
    });

    // Esc is the native dialog default; the component only has to survive it
    // and hand focus back, which is what a keyboard visitor needs to carry on
    // from where they were.
    await page.keyboard.press('Escape');
    await expect(page.locator(LIGHTBOX)).toHaveCount(0);
    await expect(page.locator(ZOOM)).toBeFocused();

    await reloadAndAssertClean(page, route, baseline, {
      afterReload: async () => {
        await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });
        await expect(page.locator(LIGHTBOX)).toHaveCount(0);
        await openLightbox(page, locale);
        await expect(page.locator(LIGHTBOX)).toBeVisible();
      },
    });
  });

  test(`the lightbox closes on a backdrop click but not on an image click (${locale})`, async ({
    page,
    request,
  }) => {
    const product = await findMultiImageProduct(request, locale);
    await page.goto(`/${locale}/catalog/product/${product.slug}`);
    await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });

    await openLightbox(page, locale);
    // A click on the image must not dismiss what the visitor opened to look at.
    await page.locator(`${LIGHTBOX} .frame img`).click();
    await expect(page.locator(LIGHTBOX)).toBeVisible();

    // The area around the figure is the backdrop, and dismisses.
    await page.locator(`${LIGHTBOX} .frame`).click({ position: { x: 4, y: 4 } });
    await expect(page.locator(LIGHTBOX)).toHaveCount(0);
    await expect(page.locator(ZOOM)).toBeFocused();
  });
});

describeEveryLocale('storefront N3 buy-box quantity and confirmation', (locale) => {
  let baseline: ConsoleBaseline;
  /**
   * The over-ask test drives the API into a deliberate 400, and Chromium logs
   * every failed request as a console error. Scoped per test rather than
   * blanket-allowed on the describe, so the happy path stays strict.
   */
  let allowed: RegExp[] = [];
  test.beforeEach(({ page }) => {
    allowed = [];
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean({ ignore: allowed });
  });

  /** Clicks the stepper one step at a time, waiting for the owner to echo each
   * value back. The stepper is controlled, so firing clicks faster than the
   * page re-renders silently drops steps. */
  async function setQuantity(page: Page, target: number): Promise<void> {
    const value = page.locator(`${QUANTITY} .value`);
    const increment = page.locator(`${QUANTITY} .increment`);
    for (let next = 2; next <= target; next += 1) {
      await increment.click();
      await expect(value).toHaveText(String(next));
    }
  }

  test(`the chosen quantity reaches the cart and the confirmation names it (${locale})`, async ({
    page,
    request,
  }) => {
    const slug = await findInStockProduct(request, locale);
    const route = `/${locale}/catalog/product/${slug}`;
    const labels = copyFor(BUY_BOX_LABELS, locale);

    await page.goto(route);
    await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });
    await expect(page.locator(QUANTITY)).toBeVisible({ timeout: FIRST_PAINT });
    await expect(page.locator(`${QUANTITY} .decrement`)).toBeDisabled();

    await setQuantity(page, 2);
    await page.locator(ADD_TO_CART).click();

    // Finding P4's other half: the label must not read as terminal after a
    // successful add, because a second click adds another unit.
    await expect(page.locator(ADD_STATUS)).toBeVisible({ timeout: FIRST_PAINT });
    await expect(page.locator(ADD_TO_CART)).toHaveText(labels.addToCart);
    await expect(page.locator(ADD_STATUS)).toContainText(
      labels.addedWithCount.replace('{count}', '2'),
    );
    await expect(page.locator(ADD_STATUS).getByText(labels.viewCart)).toBeVisible();
    await expect(page.locator(CART_BADGE)).toHaveText('2');

    // The seam a hardcoded quantity would survive unnoticed: the cart is what
    // the server actually stored.
    await reloadAndAssertClean(page, `/${locale}/cart`, baseline, {
      afterReload: async () => {
        await expect(page.locator('[data-testid^="cart-line-stepper-"] .value').first()).toHaveText(
          '2',
          { timeout: FIRST_PAINT },
        );
      },
    });
  });

  test(`the stepper stops at the cart cap and the server refuses an over-ask (${locale})`, async ({
    page,
    request,
  }) => {
    allowed = [/Failed to load resource: the server responded with a status of 400/];
    const slug = await findInStockProduct(request, locale);
    const labels = copyFor(BUY_BOX_LABELS, locale);
    await page.goto(`/${locale}/catalog/product/${slug}`);
    await expect(page.locator(QUANTITY)).toBeVisible({ timeout: FIRST_PAINT });

    // 99 is the cart line's own cap, not a stock claim: the exact count is off
    // the public wire by design, so the server stays the authority.
    await setQuantity(page, 99);
    await expect(page.locator(`${QUANTITY} .increment`)).toBeDisabled();

    // Asked twice, so the total exceeds any seeded stock. No mock: the real API
    // answers CART_INSUFFICIENT_STOCK and the page renders its localized copy.
    await page.locator(ADD_TO_CART).click();
    await expect(page.locator(ADD_TO_CART)).toBeEnabled({ timeout: FIRST_PAINT });
    await page.locator(ADD_TO_CART).click();

    await expect(page.locator(ADD_ERROR)).toBeVisible({ timeout: FIRST_PAINT });
    await expect(page.locator(ADD_ERROR)).toHaveText(labels.short);
  });
});

/**
 * N4 (finding P3, second half). An out-of-stock buy box offered nothing to do,
 * although the mail engine already emails every wishlister of a product when
 * its stock crosses back above zero. The control is the wishlist toggle
 * relabelled: no new endpoint, and no guest email capture (operator decision
 * O6 keeps this account-only).
 */
describeEveryLocale('storefront N4 back-in-stock notify control', (locale) => {
  let baseline: ConsoleBaseline;
  /**
   * The anonymous test deliberately provokes the 401 that sends a visitor to
   * sign-in. The browser logs the status the test is asserting, which is not an
   * application fault. Scoped per test so the authed path stays strict.
   */
  let allowed: RegExp[] = [];
  test.beforeEach(({ page }) => {
    allowed = [];
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean({ ignore: allowed });
  });

  test(`a signed-in customer subscribes from the out-of-stock buy box (${locale})`, async ({
    page,
    request,
  }) => {
    const product = await findOutOfStockProduct(request, locale);
    const labels = copyFor(NOTIFY_LABELS, locale);
    const session = await signUpViaApi(request, {
      email: `n4-notify-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
      password: 'Fixture-Test-123!',
      firstName: 'Back',
      lastName: 'InStock',
    });
    await attachAuthToBrowser(page, session);

    const route = `/${locale}/catalog/product/${product.slug}`;
    await page.goto(route);
    await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });

    // The buy box offers nothing to buy, so the only action must be the one
    // that is actually wired to something.
    await expect(page.locator(ADD_TO_CART)).toBeDisabled();
    await expect(page.locator(QUANTITY)).toHaveCount(0);
    await expect(page.locator(`${PRODUCT_SUMMARY} ${WISHLIST_LABEL}`)).toHaveText(labels.notify);

    // Lifecycle consent is opt-in, so the page names the switch rather than
    // promising mail it may not be allowed to send.
    const hint = page.locator(BACK_IN_STOCK_HINT);
    await expect(hint).toContainText(labels.hint);
    await expect(hint.getByRole('link', { name: labels.preferences })).toHaveAttribute(
      'href',
      `/${locale}/account/preferences`,
    );

    await page.locator(WISHLIST_TOGGLE).click();
    await expect(page.locator(WISHLIST_STATUS)).toHaveText(labels.added, {
      timeout: FIRST_PAINT,
    });
    await expect(page.locator(`${PRODUCT_SUMMARY} ${WISHLIST_LABEL}`)).toHaveText(labels.stop);

    // The pressed state has to survive the reload, which is what plan E's
    // membership store exists for; an optimistic-only toggle reads unpressed
    // here and the next click silently re-adds.
    await reloadAndAssertClean(page, route, baseline, {
      afterReload: async () => {
        await expect(page.locator(WISHLIST_TOGGLE)).toHaveAttribute('aria-pressed', 'true', {
          timeout: FIRST_PAINT,
        });
        await expect(page.locator(`${PRODUCT_SUMMARY} ${WISHLIST_LABEL}`)).toHaveText(labels.stop);
      },
    });

    // Same list, so the subscription is visible where the customer manages it.
    await page.goto(`/${locale}/account/wishlist`);
    await expect(page.locator(`a[href*="/catalog/product/${product.slug}"]`).first()).toBeVisible({
      timeout: FIRST_PAINT,
    });
  });

  test(`an anonymous click lands on sign-in carrying the return route (${locale})`, async ({
    page,
    request,
  }) => {
    allowed = [/Failed to load resource.*401/i, /\/v1\/wishlist\//i];
    const product = await findOutOfStockProduct(request, locale);
    const route = `/${locale}/catalog/product/${product.slug}`;

    await page.goto(route);
    await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });
    await page.locator(WISHLIST_TOGGLE).click();

    // The global 401 handler owns this redirect; N4 adds no second one, which
    // would race it and lose the `from`.
    await page.waitForURL(/\/auth\/login/, { timeout: FIRST_PAINT });
    const from = new URL(page.url()).searchParams.get('from');
    expect(from, 'sign-in must carry the product route back').toContain(
      `/catalog/product/${product.slug}`,
    );
  });
});
