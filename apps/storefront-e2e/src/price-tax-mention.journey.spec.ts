import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { getChromeStrings } from '../../storefront/src/i18n';

import {
  STOREFRONT_API_BASE,
  activeStoreConfigFixture,
  attachConsoleBaseline,
  authCookieHeader,
  configuredTaxDisplay,
  describeEveryLocale,
  fixtureShippableAddress,
  reloadAndAssertClean,
  signUpViaApi,
  type AuthSession,
  type ConsoleBaseline,
  type StorefrontLocale,
} from './support';

/**
 * Phase D6.2, every rendered price carries a tax mention.
 *
 * brand-floor §3.2: "Every displayed price carries TTC or HT, without
 * exception. A price with no tax mention is a brand-floor violation, not a
 * copy nit." This client's catalogue is priced HT, an operator decision
 * recorded at `plan.md` §2.2, with the TTC total shown at checkout.
 *
 * `apps/storefront/src/app/ui/price-tax-mention.guard.spec.ts` already scans
 * the SOURCE for the two ways a price reaches the screen: an `<app-price>`
 * that does not bind `taxMention`, and a file that formats money directly
 * without rendering a mention anywhere. This journey is the half a source scan
 * cannot reach. A binding can be present and still not paint, a mention can be
 * inside a collapsed branch, and a totals row can render an amount the scanner
 * never saw because the interpolation lives in a helper. So this walks the
 * RENDERED page instead: every money-shaped text node the browser actually
 * lays out, and the component that owns it.
 *
 * The unit of judgement mirrors the source guard exactly. `<app-price>` is
 * judged per element, because the component renders its own mention. A direct
 * `formatMoney` interpolation is judged per OWNING COMPONENT, because a totals
 * table states its tax posture on the rows that carry it and a mention beside
 * every intermediate figure would be wrong on the screen. At runtime the
 * component that owns a text node is its nearest ancestor whose tag name
 * carries a hyphen: every Angular selector in this app has one, no native HTML
 * element does.
 *
 * The carve-out list is the source guard's `NOT_A_PRICE`, restated as the two
 * component selectors those files declare rather than re-derived. A coupon and
 * a gift card each render the amount they take OFF a price. A deduction has no
 * tax posture of its own, and both sit in the cart page directly above
 * `cart-totals`, which states the posture for the figures they adjust.
 *
 * Real API, real seed, no `page.route()` and no fixtures per constitution §3.8.
 */

/** `coupon-form.component.ts` and `gift-card-form.component.ts` selectors. */
/**
 * Hosts whose money is not a price the customer is being quoted.
 *
 * The two forms restate a deduction the totals already carry. The checkout
 * step shell is the collapsed recap of a step the shopper has finished: it
 * repeats the delivery method and its rate as a reminder of a choice, while
 * the step-3 summary below it carries the authoritative figures with their
 * mention. Gate A found this surface unscanned, because the journey stopped one
 * step short of reaching it, and left the rule undecided. Decided at plan E2.5
 * (B2.9): a reminder of a finished choice owes no mention, and the one figure
 * here that IS a quote, the collapsed step-2 total, carries one from
 * `step-summary.ts` under every `money.taxDisplay` setting.
 *
 * `catalog-filter-rail` renders the price-band boundaries ("Under 50,00 €",
 * "50,00 € - 250,00 €") as filter option labels, not prices the shopper is
 * quoted: a bucket boundary is a fact about the catalogue's range, not a
 * figure the store is charging. It never carried a mention under the old
 * three-decimal fixture either; the two-decimal EUR display precision just
 * made the boundary text ("50,00 €") shape up as a plain money run the scan
 * had not previously flagged. `filter-rail.component.ts` formats these bounds
 * directly rather than through `<app-price>`, which is also why the static
 * per-file guard (`price-tax-mention.guard.spec.ts`) never scans this file.
 */
const NOT_A_PRICE_HOSTS = [
  'cart-coupon-form',
  'cart-gift-card-form',
  'app-checkout-step-shell',
  'catalog-filter-rail',
];

const CATALOG_GRID = '[data-testid="catalog-grid"]';
const PRODUCT_SUMMARY = '[data-testid="product-summary"]';
const FIRST_PAINT = 30_000;

const STOREFRONT_ORIGIN =
  process.env['BASE_URL'] ?? `http://localhost:${process.env['STOREFRONT_DEV_PORT'] ?? '53311'}`;

// ── Rendered-money scan ───────────────────────────────────────────────────────

interface MoneyProbe {
  /** The money-shaped run the browser laid out, e.g. `2 999,000 DT`. */
  amount: string;
  /** Tag of the component that owns the amount. */
  hostTag: string;
  hostTestId: string | null;
  /** Every configured tax mention rendered inside that component. */
  mentions: string[];
  /** True when the owning component is one of the guard's carve-outs. */
  carvedOut: boolean;
  /** The owning component's rendered text, trimmed, for the failure message. */
  context: string;
}

/**
 * Collects every visible money amount on the page and the mentions rendered
 * alongside it by its owning component.
 *
 * Money is matched on the shape `lib/money.ts` emits and nothing else: digits,
 * the configured group and decimal separators, the configured fraction count,
 * `U+00A0`, and the configured symbol on its configured side, or a bare ISO
 * code for a row carrying its own historical currency.
 *
 * Mentions are matched against the two strings the running locale actually
 * renders, not against a token split: Arabic renders `بدون ضريبة` and
 * `شامل الضريبة`, which a split on non-letters finds nothing in. `spacedText`
 * inserts a space at every element boundary first, so the symbol and the
 * mention cannot glue into one run (`...DT` + `HT` reading as `DTHT`) the way
 * a raw `textContent` concatenation does.
 */
/** Escapes a configured symbol so a character like `.` cannot widen the match. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The two mentions a checkout summary may carry, in the language being run.
 * Matching the two French abbreviations asserted a store that renders them,
 * and no other language does.
 */
/**
 * The mention this store renders for a catalogue price, in the running
 * locale, or null when it shows none.
 *
 * The config enum (`HT`, `TTC`, `none`) is not the rendered text: Arabic
 * renders `بدون ضريبة` and `شامل الضريبة`. Comparing the enum against what a
 * component painted only worked because the one Arabic fixture shows no
 * mention at all and took the other branch.
 */
function expectedMentionText(locale: StorefrontLocale): string | null {
  const display = configuredTaxDisplay();
  if (display === 'none') return null;
  const generic = getChromeStrings(locale).generic;
  return display === 'TTC' ? generic.taxIncluded : generic.taxExcluded;
}

function summaryMentionPattern(locale: StorefrontLocale): RegExp {
  const generic = getChromeStrings(locale).generic;
  return new RegExp(
    `^(${escapeForRegex(generic.taxExcluded)}|${escapeForRegex(generic.taxIncluded)})$`,
  );
}

async function scanRenderedMoney(
  page: Page,
  carveOutHosts: string[],
  locale: StorefrontLocale,
): Promise<MoneyProbe[]> {
  // Built from the active fixture rather than pinned to one store: the symbol,
  // the side it sits on and the fraction count all come from `money.*`. A
  // pattern naming `DT` with the unit last matched nothing under a
  // euro-suffixed or a dirham-prefixed store, so the scan found no price at
  // all, which this file reads as "the journey proved nothing".
  const money = activeStoreConfigFixture().money;
  // The two mentions this locale renders, whatever script they are in.
  const generic = getChromeStrings(locale).generic;
  const vocabulary = [generic.taxIncluded, generic.taxExcluded];
  const unit = escapeForRegex(money.symbol);
  const digits = `-?\\d[\\d\\u202F\\u00A0 ]*[.,]\\d{${money.displayPrecision}}`;
  const moneySource =
    money.symbolPosition === 'before'
      ? `(?:${unit}|[A-Z]{3})\\u00A0${digits}`
      : `${digits}\\u00A0(?:${unit}|[A-Z]{3})`;

  return page.evaluate(
    ({ carveOut, moneySource: source, vocabulary: words }) => {
      const MONEY = new RegExp(source);
      const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TITLE']);

      const visible = (node: Element): boolean => {
        let cursor: Element | null = node;
        while (cursor) {
          const style = window.getComputedStyle(cursor);
          if (style.display === 'none') return false;
          if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
          if (Number(style.opacity) === 0) return false;
          cursor = cursor.parentElement;
        }
        return node.getClientRects().length > 0;
      };

      /** Nearest ancestor whose tag carries a hyphen, i.e. the owning component. */
      const owningHost = (node: Element): Element | null => {
        let cursor: Element | null = node;
        while (cursor) {
          if (cursor.tagName.includes('-')) return cursor;
          cursor = cursor.parentElement;
        }
        return null;
      };

      /** Text nodes joined by a space, so sibling runs never fuse into one word. */
      const spacedText = (root: Element): string => {
        const parts: string[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const parent = node.parentElement;
          if (parent && !SKIP_TAGS.has(parent.tagName)) {
            const text = (node.nodeValue ?? '').trim();
            if (text) parts.push(text);
          }
          node = walker.nextNode();
        }
        return parts.join(' ');
      };

      // The mentions the running locale renders, passed in rather than the two
      // French abbreviations: Arabic renders `بدون ضريبة` and `شامل الضريبة`,
      // which carry no Latin letters at all, so splitting on non-letters found
      // nothing and reported every price as unmentioned.
      const mentionsIn = (root: Element): string[] => {
        const text = spacedText(root);
        return words.filter((word) => text.includes(word));
      };

      const out: MoneyProbe[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        const value = node.nodeValue ?? '';
        const match = parent && !SKIP_TAGS.has(parent.tagName) ? MONEY.exec(value) : null;
        if (parent && match && visible(parent)) {
          const host = owningHost(parent);
          const tag = (host ?? parent).tagName.toLowerCase();
          out.push({
            amount: match[0],
            hostTag: tag,
            hostTestId: (host ?? parent).getAttribute('data-testid'),
            mentions: mentionsIn(host ?? parent),
            carvedOut: carveOut.includes(tag),
            context: spacedText(host ?? parent).slice(0, 160),
          });
        }
        node = walker.nextNode();
      }
      return out;
    },
    { carveOut: carveOutHosts, moneySource, vocabulary },
  );
}

/**
 * Asserts the surface renders money at all, and that every amount that is not
 * a carved-out deduction sits inside a component that states its tax posture.
 */
function assertEveryPriceCarriesAMention(probes: MoneyProbe[], surface: string): MoneyProbe[] {
  expect(
    probes.length,
    `${surface}: no rendered price found, so this journey proved nothing. Either the surface ` +
      `stopped rendering money or lib/money.ts changed the format this scan matches.`,
  ).toBeGreaterThan(0);

  const judged = probes.filter((probe) => !probe.carvedOut);
  expect(
    judged.length,
    `${surface}: every amount was carved out as a deduction, leaving no price to judge`,
  ).toBeGreaterThan(0);

  const describe = (probe: MoneyProbe): string =>
    `${probe.amount} in <${probe.hostTag}${
      probe.hostTestId ? ` data-testid="${probe.hostTestId}"` : ''
    }>, context "${probe.context}"`;

  // A store configured to show no tax mention inverts the rule: the offence is
  // a price that carries one. Without this branch the whole file was red under
  // such a fixture for doing exactly what its config asks.
  if (configuredTaxDisplay() === 'none') {
    const mentioned = judged.filter((probe) => probe.mentions.length > 0).map(describe);
    expect(
      mentioned,
      `${surface}: this store displays no tax mention, so no price may carry one`,
    ).toEqual([]);
    return judged;
  }

  const offenders = judged.filter((probe) => probe.mentions.length === 0).map(describe);
  // If this fails: bind taxMention="excluded" on the HT price, or render
  // strings().generic.taxExcluded / taxIncluded beside a directly formatted
  // amount. If the amount is a deduction and not a price, add its component
  // selector to NOT_A_PRICE_HOSTS here and to NOT_A_PRICE in the source guard.
  expect(offenders, `${surface}: brand-floor §3.2 fails a price with no tax mention`).toEqual([]);
  return judged;
}

/**
 * Every catalogue price carries the mention the store is configured to show.
 *
 * Which one that is comes from `money.taxDisplay`, not from a plan section: a
 * tax-exclusive catalogue reads HT, a tax-inclusive one reads TTC, and a store
 * that shows neither renders no mention at all. Asserting HT outright was
 * asserting one store's tax policy.
 */
function assertCataloguePricesCarryTheConfiguredMention(
  probes: MoneyProbe[],
  surface: string,
  locale: StorefrontLocale,
): void {
  const priced = probes.filter((probe) => probe.hostTag === 'app-price');
  expect(priced.length, `${surface}: expected at least one <app-price> to render`).toBeGreaterThan(
    0,
  );
  const expected = expectedMentionText(locale);
  if (expected === null) {
    const wrong = priced
      .filter((probe) => probe.mentions.length > 0)
      .map((probe) => `${probe.amount} → ${probe.mentions.join('/')}`);
    expect(
      wrong,
      `${surface}: this store shows no tax mention, so no catalogue price may carry one`,
    ).toEqual([]);
    return;
  }
  const wrong = priced
    .filter((probe) => !probe.mentions.includes(expected))
    .map((probe) => `${probe.amount} → ${probe.mentions.join('/') || 'no mention'}`);
  expect(
    wrong,
    `${surface}: the store displays ${expected} prices, so every catalogue price reads ${expected}`,
  ).toEqual([]);
}

// ── Cart shaping through the real API ─────────────────────────────────────────

interface SeededVariant {
  slug: string;
  variantId: string;
}

/**
 * First variant of the seeded catalogue that is in stock, so an add-to-cart
 * cannot be refused for a reason unrelated to this journey.
 */
async function pickPurchasableVariant(
  request: APIRequestContext,
  locale: StorefrontLocale,
): Promise<SeededVariant> {
  const res = await request.get(`${STOREFRONT_API_BASE}/v1/products?pageSize=24`, {
    headers: { 'Accept-Language': locale },
  });
  expect(res.status(), 'GET /v1/products must answer 200 for the seeded catalogue').toBe(200);
  const body = (await res.json()) as { data?: unknown };
  const rows: unknown[] = Array.isArray(body.data) ? body.data : [];

  let fallback: SeededVariant | null = null;
  for (const row of rows) {
    const product = row as { slug?: unknown; variants?: unknown };
    if (typeof product.slug !== 'string') continue;
    const variants: unknown[] = Array.isArray(product.variants) ? product.variants : [];
    for (const entry of variants) {
      const variant = entry as { id?: unknown; availability?: unknown };
      if (typeof variant.id !== 'string') continue;
      const candidate: SeededVariant = { slug: product.slug, variantId: variant.id };
      if (variant.availability === 'IN_STOCK') return candidate;
      fallback = fallback ?? candidate;
    }
  }
  expect(
    fallback,
    'the seeded catalogue must expose at least one purchasable variant',
  ).not.toBeNull();
  return fallback as SeededVariant;
}

async function addToCart(
  request: APIRequestContext,
  variantId: string,
  headers: Record<string, string> = {},
): Promise<string | null> {
  const res = await request.post(`${STOREFRONT_API_BASE}/v1/cart/items`, {
    headers,
    data: { variantId, quantity: 1 },
  });
  expect([200, 201], 'POST /v1/cart/items must succeed').toContain(res.status());
  const setCookie = res.headers()['set-cookie'] ?? '';
  return /sessionId=([^;]+)/.exec(setCookie)?.[1] ?? null;
}

async function applyCartCookie(context: BrowserContext, value: string): Promise<void> {
  await context.addCookies([
    {
      name: 'sessionId',
      value,
      url: STOREFRONT_ORIGIN,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

async function createDefaultAddress(
  request: APIRequestContext,
  session: AuthSession,
  locale: StorefrontLocale,
): Promise<void> {
  const res = await request.post(`${STOREFRONT_API_BASE}/v1/users/me/addresses`, {
    headers: {
      Cookie: authCookieHeader(session),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': locale,
    },
    data: {
      label: 'Cabinet',
      ...fixtureShippableAddress({ fullName: 'Fixture Test' }),
      isDefaultShipping: true,
      isDefaultBilling: true,
    },
  });
  expect(res.status(), 'POST /v1/users/me/addresses must create the checkout address').toBe(201);
}

describeEveryLocale('storefront D6.2 price tax mention', (locale) => {
  // Console + uncaught-error baseline mandated by
  // `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`catalogue and product page render no price without a mention (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/catalog`);
    await expect(page.locator(CATALOG_GRID).first()).toBeVisible({ timeout: FIRST_PAINT });

    const catalogue = await scanRenderedMoney(page, NOT_A_PRICE_HOSTS, locale);
    const cataloguePrices = assertEveryPriceCarriesAMention(catalogue, `/${locale}/catalog`);
    assertCataloguePricesCarryTheConfiguredMention(cataloguePrices, `/${locale}/catalog`, locale);

    const productLink = page.locator(`${CATALOG_GRID} app-product-card a`).first();
    await expect(productLink).toBeVisible({ timeout: FIRST_PAINT });
    const href = await productLink.getAttribute('href');
    expect(href, 'a catalogue card must link to a product page').toBeTruthy();

    await page.goto(href!);
    await expect(page.locator(PRODUCT_SUMMARY)).toBeVisible({ timeout: FIRST_PAINT });

    const product = await scanRenderedMoney(page, NOT_A_PRICE_HOSTS, locale);
    const productPrices = assertEveryPriceCarriesAMention(product, `product page ${href}`);
    assertCataloguePricesCarryTheConfiguredMention(productPrices, `product page ${href}`, locale);
  });

  test(`the cart renders no price without a mention, across a reload (${locale})`, async ({
    page,
    context,
    request,
  }) => {
    const variant = await pickPurchasableVariant(request, locale);
    const sessionCookie = await addToCart(request, variant.variantId);
    expect(
      sessionCookie,
      'the API must return a sessionId cookie on the first cart write',
    ).toBeTruthy();
    await applyCartCookie(context, sessionCookie!);

    const route = `/${locale}/cart`;
    await page.goto(route);
    await expect(page.locator('[data-testid="cart-items"]')).toBeVisible({ timeout: FIRST_PAINT });
    await expect(page.locator('[data-testid="cart-totals"]')).toBeVisible({ timeout: FIRST_PAINT });

    const cartMention = page.locator('[data-testid="cart-totals-tax-mention"]');
    const expectedMention = expectedMentionText(locale);
    if (expectedMention === null) {
      await expect(cartMention).toHaveCount(0);
    } else {
      await expect(cartMention).toBeVisible({ timeout: FIRST_PAINT });
      await expect(cartMention).toHaveText(expectedMention);
    }

    assertEveryPriceCarriesAMention(
      await scanRenderedMoney(page, NOT_A_PRICE_HOSTS, locale),
      route,
    );

    // Leaving and returning re-renders the cart from a refetched payload rather
    // than from the SSR snapshot. A mention that only survives the first paint
    // fails here, with no new console error allowed across the seam.
    await reloadAndAssertClean(page, route, baseline, {
      afterReload: async () => {
        await expect(page.locator('[data-testid="cart-totals"]')).toBeVisible({
          timeout: FIRST_PAINT,
        });
        assertEveryPriceCarriesAMention(
          await scanRenderedMoney(page, NOT_A_PRICE_HOSTS, locale),
          `${route} after reload`,
        );
      },
    });
  });

  test(`the checkout summary renders no price without a mention (${locale})`, async ({
    page,
    request,
  }) => {
    // A fresh customer per run, so no other spec's cart or address can shape
    // this one. `AUTH_SKIP_EMAIL_VERIFICATION=1` on the e2e API means the
    // sign-up response already carries an authenticated session.
    const session = await signUpViaApi(request, {
      email: `d6-tax-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
      password: 'Fixture-Test-123!',
      firstName: 'Tax',
      lastName: 'Mention',
    });
    await createDefaultAddress(request, session, locale);

    const variant = await pickPurchasableVariant(request, locale);
    await addToCart(request, variant.variantId, {
      Cookie: authCookieHeader(session),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': locale,
    });
    await page.context().addCookies(session.cookies);

    await page.goto(`/${locale}/checkout`);
    await expect(page.getByTestId('checkout-page')).toBeVisible({ timeout: FIRST_PAINT });

    // Step 1 auto-selects the default address and step 2 auto-selects the
    // default delivery method, so confirming each is the whole interaction
    // between load and the summary. The summary itself is a price surface, not
    // availability, so §8.2's never-behind-a-click rule does not apply to
    // reaching it.
    //
    // Step 2 has to be confirmed as well: the summary moved to step 3 when the
    // delivery-method step landed, and the storefront seed keeps two active
    // methods, so the flow stops there for a choice instead of falling
    // through. This test only confirmed step 1 and had been waiting for a
    // summary one step away ever since.
    const confirmAddress = page.locator(
      '[data-testid="checkout-step-shell"][data-step="1"] .step-actions button',
    );
    await expect(confirmAddress).toBeVisible({ timeout: FIRST_PAINT });
    await confirmAddress.click();

    const confirmDelivery = page.locator(
      '[data-testid="checkout-step-shell"][data-step="2"] .step-actions button',
    );
    await expect(confirmDelivery).toBeVisible({ timeout: FIRST_PAINT });
    await confirmDelivery.click();

    const summary = page.getByTestId('order-summary');
    await expect(summary).toBeVisible({ timeout: FIRST_PAINT });

    const summaryMention = page.getByTestId('order-summary-tax-mention');
    if (configuredTaxDisplay() === 'none') {
      // A store that displays no tax mention shows none here either.
      await expect(summaryMention).toHaveCount(0);
    } else {
      // Tax-exclusive until a tax zone resolves, tax-inclusive once VAT is
      // folded into the total. Both are truthful, neither may be absent, and
      // both are read from the catalogue rather than matched against the two
      // French abbreviations, which no other language renders.
      await expect(summaryMention).toBeVisible();
      await expect(summaryMention).toHaveText(summaryMentionPattern(locale));
    }

    assertEveryPriceCarriesAMention(
      await scanRenderedMoney(page, NOT_A_PRICE_HOSTS, locale),
      `/${locale}/checkout`,
    );

    // This test mutates: a customer, a default address, and a cart line. Leaving
    // and returning re-renders the summary from a refetched payload rather than
    // from the SSR snapshot, so a mention that only survives the first paint
    // fails here. No new console error is allowed across the seam.
    await reloadAndAssertClean(page, `/${locale}/checkout`, baseline, {
      afterReload: async () => {
        // `CheckoutPage.currentStep` (index.page.ts:221) is a plain signal
        // seeded at `1` on every mount, with no restore path from the
        // fetched address or cart, so a full reload legitimately reopens
        // the accordion at step 1 even though the address is still the
        // fetched default. The single confirm click that reached the
        // summary before the reload has to run again here for the same
        // reason it ran the first time.
        const confirmAddressAgain = page.locator(
          '[data-testid="checkout-step-shell"][data-step="1"] .step-actions button',
        );
        await expect(confirmAddressAgain).toBeVisible({ timeout: FIRST_PAINT });
        await confirmAddressAgain.click();

        const confirmDeliveryAgain = page.locator(
          '[data-testid="checkout-step-shell"][data-step="2"] .step-actions button',
        );
        await expect(confirmDeliveryAgain).toBeVisible({ timeout: FIRST_PAINT });
        await confirmDeliveryAgain.click();

        const reloaded = page.getByTestId('order-summary');
        await expect(reloaded).toBeVisible({ timeout: FIRST_PAINT });
        const reloadedMention = page.getByTestId('order-summary-tax-mention');
        if (configuredTaxDisplay() === 'none') {
          await expect(reloadedMention).toHaveCount(0);
        } else {
          await expect(reloadedMention).toHaveText(summaryMentionPattern(locale));
        }
        assertEveryPriceCarriesAMention(
          await scanRenderedMoney(page, NOT_A_PRICE_HOSTS, locale),
          `/${locale}/checkout after reload`,
        );
      },
    });
  });
});
