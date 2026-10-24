import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { Cart } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { CartTotalsComponent } from './cart-totals.component';
import { getChromeStrings } from '../../../i18n';
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

/** U+00A0, built from its codepoint so no whitespace normaliser can flatten it. */
const NBSP = String.fromCodePoint(0x00a0);

const cartWithItems: Cart = {
  id: '00000000-0000-0000-0000-000000000001',
  items: [
    {
      id: 'item-1',
      variantId: '22222222-2222-2222-2222-222222222222',
      productSlug: 'fx-x',
      productName: 'X',
      unitPrice: '50.00',
      quantity: 2,
      lineTotal: '100.00',
    },
  ],
  subtotal: '100.00',
  discounts: [],
  discountAmount: '10.00',
  total: '90.00',
};

const emptyCart: Cart = {
  id: '00000000-0000-0000-0000-000000000002',
  items: [],
  subtotal: '0.00',
  discounts: [],
  total: '0.00',
};

describe('CartTotalsComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders subtotal + discount + shipping estimate + total when discount applied', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelectorAll('.row').length).toBeGreaterThanOrEqual(3);
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-discount"]'),
    ).not.toBeNull();
    // The grand total is asserted as an EXACT string. A length check here
    // passes on "NaN", on "undefined DT", and on a two-decimal amount, which
    // is how the single most money-critical string on the storefront went
    // through a currency rebrand without a test noticing.
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-grand"]')?.textContent?.trim(),
    ).toBe(`90,000${NBSP}${SYMBOL}`);
    expect(
      fixture.nativeElement.querySelector('.hint')?.textContent?.trim().length,
    ).toBeGreaterThan(0);
  });

  it('renders every totals row as an exact amount at millime precision', async () => {
    const cart: Cart = {
      ...cartWithItems,
      shippingEstimate: '8.000',
      taxEstimate: '17.100',
      grandTotal: '98.000',
      grandTotalTtc: '115.100',
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(`100,000${NBSP}${SYMBOL}`); // subtotal
    expect(text).toContain(`10,000${NBSP}${SYMBOL}`); // discount
    expect(text).toContain(`8,000${NBSP}${SYMBOL}`); // shipping
    expect(text).toContain(`17,100${NBSP}${SYMBOL}`); // VAT — the row that never rendered
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-grand"]')?.textContent?.trim(),
    ).toBe(`98,000${NBSP}${SYMBOL}`);
    // No amount anywhere may carry exactly two fraction digits.
    expect(text).not.toMatch(/\d[.,]\d{2}(?!\d)/);
  });

  it('labels the cart total HT, which the cart quotes, per the configured money.taxDisplay', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="cart-totals-tax-mention"]')
        ?.textContent?.trim(),
    ).toBe('HT');
  });

  it('hides discount row when discountAmount is zero or absent', async () => {
    const cart: Cart = { ...cartWithItems, discountAmount: '0.00' };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('[data-testid="cart-totals-discount"]')).toBeNull();
  });

  it('renders shipping number when the API sends a shipping estimate', async () => {
    // `shippingEstimate`, which is the field the API emits. The component read
    // `shippingAmount`, a name nothing has ever sent, so this row was blank in
    // production while this spec passed on a fixture that invented the field.
    const cart: Cart = { ...cartWithItems, shippingEstimate: '15.000' };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('.hint')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.row').length).toBeGreaterThanOrEqual(3);
  });

  it('marks checkout CTA disabled when cart has no items', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: emptyCart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const cta = fixture.nativeElement.querySelector(
      '[data-testid="cart-checkout-cta"]',
    ) as HTMLAnchorElement;
    expect(cta.classList.contains('disabled')).toBe(true);
    expect(cta.getAttribute('aria-disabled')).toBe('true');
  });

  it('marks checkout CTA disabled when pending=true', async () => {
    const fixture = await renderComponent(
      CartTotalsComponent,
      { cart: cartWithItems, pending: true },
      [provideRouter([]), LocaleService],
    );
    const cta = fixture.nativeElement.querySelector(
      '[data-testid="cart-checkout-cta"]',
    ) as HTMLAnchorElement;
    expect(cta.classList.contains('disabled')).toBe(true);
  });

  it('emits checkoutClicked when the enabled CTA is clicked', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received = false;
    fixture.componentInstance.checkoutClicked.subscribe(() => {
      received = true;
    });
    const cta = fixture.nativeElement.querySelector(
      '[data-testid="cart-checkout-cta"]',
    ) as HTMLAnchorElement;
    cta.click();
    expect(received).toBe(true);
  });

  it('does not emit checkoutClicked when the CTA is disabled (empty cart)', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: emptyCart }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received = false;
    fixture.componentInstance.checkoutClicked.subscribe(() => {
      received = true;
    });
    const cta = fixture.nativeElement.querySelector(
      '[data-testid="cart-checkout-cta"]',
    ) as HTMLAnchorElement;
    cta.click();
    expect(received).toBe(false);
  });

  it('renders one labelled row per discounts[] entry, not one merged total', async () => {
    // The API sends `discounts[]` with a Translatable `label` per promotion.
    // The component summed them into a single anonymous "Discount" row, so an
    // automatic promotion took hundreds off the total with nothing on screen
    // naming it: the coupon box said -96 while the totals block said -576.
    const cart: Cart = {
      ...cartWithItems,
      discountAmount: undefined,
      discounts: [
        {
          promotionId: 'promo-buy2',
          label: {
            default: 'Buy 2, Get 1 Free',
            fr: 'Achetez 2 articles, 1 offert',
            en: 'Buy 2, Get 1 Free',
          },
          amount: '48.000',
          type: 'automatic',
        },
        {
          promotionId: '',
          label: 'WELCOME10',
          amount: '9.600',
          type: 'coupon',
        },
      ],
      total: '42.400',
      grandTotal: '42.400',
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="cart-totals-discount"]');
    expect(rows.length).toBe(2);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // `LocaleService` defaults to `fr`, so the fr side of the Translatable is
    // the string that must reach the row.
    expect(text).toContain('Achetez 2 articles, 1 offert');
    expect(text).not.toContain('Buy 2, Get 1 Free');
    expect(text).toContain('WELCOME10');
    expect(text).toContain(`48,000${NBSP}${SYMBOL}`);
    expect(text).toContain(`9,600${NBSP}${SYMBOL}`);
    expect(rows[0].getAttribute('data-type')).toBe('automatic');
    expect(rows[1].getAttribute('data-type')).toBe('coupon');
  });

  it('skips a zero-amount discount line rather than rendering it as money', async () => {
    // FREE_SHIPPING entries carry amount 0 by design: the engine calls them a
    // signal, honoured on the shipping row, not a monetary line.
    const cart: Cart = {
      ...cartWithItems,
      discountAmount: undefined,
      discounts: [
        {
          promotionId: 'promo-freeship',
          label: { default: 'Free shipping', fr: 'Livraison offerte', en: 'Free shipping' },
          amount: '0.000',
          type: 'automatic',
        },
      ],
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="cart-totals-discount"]').length,
    ).toBe(0);
  });

  it('resolves a Translatable discount label into the active locale, never [object Object]', async () => {
    const cart: Cart = {
      ...cartWithItems,
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
      ],
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('[object Object]');
    expect(text).toContain('Achetez 2 articles, 1 offert');
  });

  it('keeps one merged row when the API sent a discountAmount but no lines', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
      provideRouter([]),
      LocaleService,
    ]);
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="cart-totals-discount"]');
    expect(rows.length).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(`10,000${NBSP}${SYMBOL}`);
  });

  it('labels a shipping amount on the cart as an estimate, not a charge', async () => {
    // The cart prints the store's pre-address default rate as a plain amount.
    // Nothing said it was provisional, so a figure that the delivery address
    // can still change read as the price the shopper would be charged.
    const cart: Cart = { ...cartWithItems, shippingEstimate: '8.000', grandTotal: '98.000' };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const label = fixture.nativeElement.querySelector(
      '[data-testid="cart-totals-shipping-estimate-label"]',
    );
    expect(label).not.toBeNull();
    expect(label?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('does not label the shipping row an estimate when there is no amount to qualify', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-shipping-estimate-label"]'),
    ).toBeNull();
  });

  it('tells the shopper VAT still comes, since the cart quotes HT', async () => {
    // `plan.md` §2.2 decided the catalogue and cart quote HT and the TTC total
    // appears at checkout. What was missing was the bridge: the cart showed an
    // HT total with nothing saying VAT was still to come, so the checkout
    // figure looked like a price rise.
    const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
      provideRouter([]),
      LocaleService,
    ]);
    const hint = fixture.nativeElement.querySelector('[data-testid="cart-totals-vat-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('19');
    // The cart must not grow a TTC figure: that is the checkout's job, and
    // quoting both here is what option B of the decision explicitly rejected.
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('TTC');
  });

  it('drops the VAT hint once a real tax estimate has resolved', async () => {
    const cart: Cart = { ...cartWithItems, taxEstimate: '17.100' };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('[data-testid="cart-totals-vat-hint"]')).toBeNull();
  });

  it('says Free rather than printing a zero amount when shipping is free', async () => {
    // A qualifying FREE_SHIPPING promotion zeroes the estimate server-side.
    // Rendering that as "0,000 DT" reads like a missing value; the row has to
    // say what actually happened.
    const cart: Cart = { ...cartWithItems, shippingEstimate: '0.000', grandTotal: '90.000' };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const row = fixture.nativeElement.querySelector('[data-testid="cart-totals-shipping"]');
    expect(row?.textContent).toContain('Gratuite');
    expect(row?.textContent).not.toContain('0,000');
    // A free row is not an estimate that the address can revise.
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-shipping-estimate-label"]'),
    ).toBeNull();
  });

  it('tells the shopper how much more earns free delivery', async () => {
    // `freeShippingProgress` has always been in the cart response and nothing
    // in the storefront read it, so a basket 25 DT short of the threshold said
    // nothing at all.
    const cart: Cart = {
      ...cartWithItems,
      shippingEstimate: '8.000',
      freeShippingProgress: { threshold: 300, remaining: 25, qualified: false },
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const hint = fixture.nativeElement.querySelector(
      '[data-testid="cart-totals-free-shipping-progress"]',
    );
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain(`25,000${NBSP}${SYMBOL}`);
  });

  it('drops the free-delivery nudge once the basket qualifies', async () => {
    const cart: Cart = {
      ...cartWithItems,
      shippingEstimate: '0.000',
      freeShippingProgress: { threshold: 300, remaining: 0, qualified: true },
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-free-shipping-progress"]'),
    ).toBeNull();
  });

  it('shows no nudge when the store has no free-shipping threshold', async () => {
    const cart: Cart = {
      ...cartWithItems,
      shippingEstimate: '8.000',
      freeShippingProgress: { threshold: null, remaining: null, qualified: false },
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-free-shipping-progress"]'),
    ).toBeNull();
  });

  it('shows the applied gift card as its own negative row and a payable total', async () => {
    // A gift card is tender, not a discount: it does not change what the goods
    // cost, it changes what is left to pay. Nothing on the totals block showed
    // it at all, so a shopper with a card applied saw the full total right up
    // to the confirmation page.
    const cart: Cart = {
      ...cartWithItems,
      grandTotal: '90.000',
      giftCard: { code: 'FXGIFTWELCOME100', balanceApplied: '30.000' },
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    const row = fixture.nativeElement.querySelector('[data-testid="cart-totals-gift-card"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain(`30,000${NBSP}${SYMBOL}`);
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-payable"]')?.textContent,
    ).toContain(`60,000${NBSP}${SYMBOL}`);
    // The goods total is unchanged: the card is tender, not a price cut.
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-grand"]')?.textContent?.trim(),
    ).toBe(`90,000${NBSP}${SYMBOL}`);
  });

  it('never shows a payable total below zero when the card covers everything', async () => {
    const cart: Cart = {
      ...cartWithItems,
      grandTotal: '90.000',
      giftCard: { code: 'FXGIFTWELCOME100', balanceApplied: '90.000' },
    };
    const fixture = await renderComponent(CartTotalsComponent, { cart }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-payable"]')?.textContent,
    ).toContain(`0,000${NBSP}${SYMBOL}`);
  });

  it('shows no gift-card row when none is applied', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('[data-testid="cart-totals-gift-card"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="cart-totals-payable"]')).toBeNull();
  });

  it('axe — zero serious / critical violations', async () => {
    const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['region', 'landmark-one-main', 'page-has-heading-one'],
    });
  });

  describe('tax mention source', () => {
    it('renders no mention for a store that displays none', async () => {
      const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
        provideRouter([]),
        LocaleService,
        provideFixtureStoreConfig('gulf-rtl'),
      ]);
      expect(fixtureRuntimeConfig('gulf-rtl').money.taxDisplay).toBe('none');
      expect(
        fixture.nativeElement.querySelector('[data-testid="cart-totals-tax-mention"]'),
      ).toBeNull();
    });

    it('labels the total tax-inclusive for a store whose catalogue is', async () => {
      const fixture = await renderComponent(CartTotalsComponent, { cart: cartWithItems }, [
        provideRouter([]),
        LocaleService,
        provideFixtureStoreConfig('demo'),
      ]);
      expect(fixtureRuntimeConfig('demo').money.taxDisplay).toBe('TTC');
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="cart-totals-tax-mention"]')
          ?.textContent?.trim(),
      ).toBe(getChromeStrings('fr').generic.taxIncluded);
    });
  });
});
