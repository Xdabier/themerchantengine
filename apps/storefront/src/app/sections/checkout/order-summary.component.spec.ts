import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Cart } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { OrderSummaryComponent } from './order-summary.component';
import {
  fixtureMoney,
  fixtureRuntimeConfig,
  provideFixtureStoreConfig,
} from '../../../test-support/store-config-fixtures';

/**
 * Money assertions run under the `maghreb-ltr` scenario fixture: a
 * three-decimal currency with the narrow no-break space as its group
 * separator. The precision is the load-bearing part, because a rule that only
 * breaks at three decimals passes untested under a two-decimal store.
 */
const FIXTURE_MONEY = fixtureMoney('maghreb-ltr');
const SYMBOL = FIXTURE_MONEY.symbol;

const fakeCart: Cart = {
  id: 'cart-1',
  items: [
    {
      id: 'line-1',
      variantId: 'v-1',
      productSlug: 'fx-laptop',
      productName: { fr: 'Ordinateur portable', en: 'Laptop' },
      unitPrice: '1500.00',
      quantity: 1,
    },
    {
      id: 'line-2',
      variantId: 'v-2',
      productSlug: 'fx-mouse',
      productName: { fr: 'Souris', en: 'Mouse' },
      unitPrice: '50.00',
      quantity: 2,
    },
  ] as unknown as Cart['items'],
  subtotal: '1600.00',
  discounts: [],
  discountAmount: '0',
  shippingAmount: '0',
  taxAmount: '0',
  total: '1600.00',
} as unknown as Cart;

describe('OrderSummaryComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders one row per cart line with the line total', async () => {
    const fixture = await renderComponent(OrderSummaryComponent, { cart: fakeCart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const rows = fixture.nativeElement.querySelectorAll('.line');
    expect(rows.length).toBe(2);
    const total = fixture.nativeElement.querySelector(
      '[data-testid="order-summary-total"]',
    ) as HTMLElement;
    // The whole rendered string, not a fragment and not a length check. A
    // length check here passes on "NaN", on "undefined DT" and on a
    // two-decimal amount, which is exactly what let the old contract survive
    // the rebrand. `LocaleService` defaults to `fr`, so the group separator is
    // U+202F, the decimal is a comma, and the configured symbol follows a U+00A0.
    expect(total.textContent?.trim()).toBe(
      `1${String.fromCodePoint(0x202f)}600,000${String.fromCodePoint(0x00a0)}${SYMBOL}`,
    );
    expect(total.textContent).not.toMatch(/AED|د\.إ/);
    expect(total.textContent).not.toMatch(/[.,]\d{2}(?!\d)/);
  });

  it('hides the discount row when discountAmount is zero', async () => {
    const fixture = await renderComponent(OrderSummaryComponent, { cart: fakeCart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="order-summary-discount"]'),
    ).toBeNull();
  });

  it('renders the discount row when a discount applies', async () => {
    const discounted: Cart = {
      ...fakeCart,
      discounts: [],
      discountAmount: '160',
      total: '1440.00',
    } as unknown as Cart;
    const fixture = await renderComponent(OrderSummaryComponent, { cart: discounted }, [
      provideRouter([]),
      LocaleService,
    ]);
    const discountRow = fixture.nativeElement.querySelector(
      '[data-testid="order-summary-discount"]',
    ) as HTMLElement;
    expect(discountRow).not.toBeNull();
    expect(discountRow.textContent).toContain('-');
  });

  it('has no cod-fee row at all, since nothing in the system emits one', async () => {
    // The row read `codFee` through a cast, because `Cart` has no such field
    // and no producer anywhere in the API sends one, so it rendered a money
    // line that was always zero. The old spec asserted the row was absent for
    // a cart "with no codFee scalar", true of every cart that has ever
    // existed, which is why it never showed the row was dead.
    const fixture = await renderComponent(OrderSummaryComponent, { cart: fakeCart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('[data-testid="order-summary-cod-fee"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('livraison');
  });

  it('labels the checkout total with a tax mention, which the charte requires', async () => {
    const fixture = await renderComponent(OrderSummaryComponent, { cart: fakeCart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const mention = fixture.nativeElement.querySelector(
      '[data-testid="order-summary-tax-mention"]',
    ) as HTMLElement;
    expect(mention).not.toBeNull();
    // No tax estimate on this fixture, so the total is still tax-exclusive and
    // must say so rather than claiming TTC.
    expect(mention.textContent?.trim()).toBe('HT');
  });

  it('renders the VAT row and a TTC total once a tax zone has resolved', async () => {
    // Every other case on this fixture leaves `taxEstimate` unset, so the VAT
    // row, the TTC mention and the `grandTotalTtc` binding were all asserted
    // only in their absent state. That is the branch a tax-exclusive checkout
    // actually renders, and nothing covered it.
    const taxed: Cart = {
      ...fakeCart,
      // The fixture's own VAT rate applied to the HT goods total.
      taxEstimate: '304.000',
      shippingEstimate: '0',
      grandTotal: '1600.000',
      grandTotalTtc: '1904.000',
    } as unknown as Cart;
    const fixture = await renderComponent(OrderSummaryComponent, { cart: taxed }, [
      provideRouter([]),
      LocaleService,
    ]);

    const taxRow = fixture.nativeElement.querySelector(
      '[data-testid="order-summary-tax"]',
    ) as HTMLElement;
    expect(taxRow).not.toBeNull();
    expect(taxRow.textContent).toContain('TVA');
    expect(taxRow.textContent).toContain(`304,000${String.fromCodePoint(0x00a0)}${SYMBOL}`);

    // The headline must be the TTC figure, not `grandTotal`. Binding it to the
    // HT total under-quotes the charge by the whole of the VAT.
    const total = fixture.nativeElement.querySelector(
      '[data-testid="order-summary-total"]',
    ) as HTMLElement;
    expect(total.textContent?.trim()).toBe(
      `1${String.fromCodePoint(0x202f)}904,000${String.fromCodePoint(0x00a0)}${SYMBOL}`,
    );

    const mention = fixture.nativeElement.querySelector(
      '[data-testid="order-summary-tax-mention"]',
    ) as HTMLElement;
    expect(mention.textContent?.trim()).toBe('TTC');
  });

  it('shows the picked shipping rate and folds its delta into the total', async () => {
    // `Cart.shippingEstimate` caches the ZONE DEFAULT, which is the whole
    // reason a chooser was needed: picking the 5.000 method left the summary
    // quoting the 8.000 default and the customer confirming a number the order
    // would not charge.
    const quoted: Cart = {
      ...fakeCart,
      taxEstimate: '304.000',
      shippingEstimate: '8.000',
      grandTotal: '1608.000',
      grandTotalTtc: '1912.000',
    } as unknown as Cart;
    const fixture = await renderComponent(
      OrderSummaryComponent,
      {
        cart: quoted,
        selectedShippingRate: { methodId: 'sm-express', name: 'Express', price: '5.000' },
      },
      [provideRouter([]), LocaleService],
    );
    const rows = [...fixture.nativeElement.querySelectorAll('.row')] as HTMLElement[];
    const shippingRow = rows.find((r) => r.textContent?.includes('Livraison'));
    expect(shippingRow?.textContent).toContain(`5,000${String.fromCodePoint(0x00a0)}${SYMBOL}`);
    const total = fixture.nativeElement.querySelector(
      '[data-testid="order-summary-total"]',
    ) as HTMLElement;
    // 1912.000 quoted against the 8.000 default, less the 3.000 the cheaper
    // method saves.
    expect(total.textContent?.trim()).toBe(
      `1${String.fromCodePoint(0x202f)}909,000${String.fromCodePoint(0x00a0)}${SYMBOL}`,
    );
  });

  it('keeps free shipping free whatever method is picked', async () => {
    // A free-shipping promotion zeroes `shippingEstimate` server-side. The
    // picked rate must not resurrect the charge the promotion removed.
    const free: Cart = {
      ...fakeCart,
      shippingEstimate: '0',
      grandTotal: '1600.000',
      grandTotalTtc: '1600.000',
    } as unknown as Cart;
    const fixture = await renderComponent(
      OrderSummaryComponent,
      {
        cart: free,
        selectedShippingRate: { methodId: 'sm-standard', name: 'Standard', price: '8.000' },
      },
      [provideRouter([]), LocaleService],
    );
    const rows = [...fixture.nativeElement.querySelectorAll('.row')] as HTMLElement[];
    const shippingRow = rows.find((r) => r.textContent?.includes('Livraison'));
    expect(shippingRow?.textContent).toContain('Port inclus');
    const total = fixture.nativeElement.querySelector(
      '[data-testid="order-summary-total"]',
    ) as HTMLElement;
    expect(total.textContent?.trim()).toBe(
      `1${String.fromCodePoint(0x202f)}600,000${String.fromCodePoint(0x00a0)}${SYMBOL}`,
    );
  });

  it('itemises discounts[] the same way the cart does, one labelled row each', async () => {
    // The checkout summary merged every promotion into one anonymous row, so a
    // customer reviewing the order before paying could not tell which discount
    // took what. Same contract as the cart totals: one row per entry.
    const cart: Cart = {
      ...fakeCart,
      discountAmount: undefined,
      discounts: [
        {
          promotionId: 'promo-buy2',
          label: {
            default: 'Achetez 2 articles, 1 offert',
            fr: 'Achetez 2 articles, 1 offert',
            en: 'Buy 2, Get 1 Free',
          },
          amount: '48.000',
          type: 'automatic',
        },
        { promotionId: '', label: 'WELCOME10', amount: '9.600', type: 'coupon' },
      ],
    } as unknown as Cart;
    const fixture = await renderComponent(OrderSummaryComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="order-summary-discount"]');
    expect(rows.length).toBe(2);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Achetez 2 articles, 1 offert');
    expect(text).toContain('WELCOME10');
    expect(text).not.toContain('[object Object]');
  });

  it('skips a zero-amount discount entry on the checkout summary too', async () => {
    const cart: Cart = {
      ...fakeCart,
      discountAmount: undefined,
      discounts: [
        {
          promotionId: 'promo-freeship',
          label: { default: 'Livraison offerte', fr: 'Livraison offerte', en: 'Free shipping' },
          amount: '0.000',
          type: 'automatic',
        },
      ],
    } as unknown as Cart;
    const fixture = await renderComponent(OrderSummaryComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="order-summary-discount"]').length,
    ).toBe(0);
  });

  it('carries the gift card through to the checkout summary as tender', async () => {
    // Checkout is the last surface before payment. A card applied on the cart
    // that shows nowhere here means the shopper confirms one number and is
    // charged another.
    const cart: Cart = {
      ...fakeCart,
      grandTotalTtc: '1600.000',
      giftCard: { code: 'FXGIFTWELCOME100', balanceApplied: '100.000' },
    } as unknown as Cart;
    const fixture = await renderComponent(OrderSummaryComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const row = fixture.nativeElement.querySelector('[data-testid="order-summary-gift-card"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('FXGIFTWELCOME100');
    const payable = fixture.nativeElement.querySelector('[data-testid="order-summary-payable"]');
    expect(payable?.textContent).toContain('1');
    expect(payable?.textContent).toContain('500,000');
  });

  it('shows no gift-card row on the summary when none is applied', async () => {
    const fixture = await renderComponent(OrderSummaryComponent, { cart: fakeCart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="order-summary-gift-card"]'),
    ).toBeNull();
  });

  it('renders zero serious or critical axe violations', async () => {
    const fixture = await renderComponent(OrderSummaryComponent, { cart: fakeCart }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['html-has-lang', 'landmark-one-main', 'region', 'heading-order'],
    });
  });

  describe('tax mention source', () => {
    // The four sites that became config-driven late had no unit coverage of
    // the branches they gained, so the `none` and `TTC` paths were guarded by
    // an e2e journey that could not see them.
    it('renders no mention for a store that displays none', async () => {
      const fixture = await renderComponent(OrderSummaryComponent, { cart: fakeCart }, [
        provideRouter([]),
        LocaleService,
        provideFixtureStoreConfig('gulf-rtl'),
      ]);
      expect(fixtureRuntimeConfig('gulf-rtl').money.taxDisplay).toBe('none');
      expect(
        fixture.nativeElement.querySelector('[data-testid="order-summary-tax-mention"]'),
      ).toBeNull();
    });
  });
});
