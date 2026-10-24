import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CartService } from '@storefront-services';
import type { Cart } from '@storefront-types';
import { StorefrontValidationError } from '@storefront-types';

import { AuthStateService } from '../../../services/auth-state.service';
import { WishlistStateService } from '../../../services/wishlist-state.service';
import { LocaleService } from '../../../locale.service';
import { getChromeStrings } from '../../../../i18n';
import { type Locale } from '../../../../i18n/types';
import CartPage from './index.page';
import { fixtureChromeIdentity } from '../../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;

  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }

  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
  readonly currentUrl = () => `/${this._locale()}/cart`;
}

const SEEDED_CART: Cart = {
  id: '00000000-0000-0000-0000-000000000010',
  items: [
    {
      id: 'line-1',
      variantId: '22222222-2222-2222-2222-222222222222',
      productSlug: 'fx-laptop-pro-16-studio',
      productName: 'Laptop Pro 16 Studio',
      primaryAsset: { url: '/uploads/laptop.jpg' },
      unitPrice: '4999.00',
      quantity: 1,
      lineTotal: '4999.00',
    },
  ],
  subtotal: '4999.00',
  discounts: [],
  total: '4999.00',
};

const EMPTY_CART: Cart = {
  id: '00000000-0000-0000-0000-000000000020',
  items: [],
  subtotal: '0.00',
  discounts: [],
  total: '0.00',
};

const CART_WITH_COUPON: Cart = {
  ...SEEDED_CART,
  discounts: [
    { promotionId: 'promo-1', label: 'FIXTURE10', amount: '10.00', type: 'coupon' as const },
  ],
  discountAmount: '10.00',
  total: '4989.00',
  couponCode: 'FIXTURE10',
  coupon: { code: 'FIXTURE10', discount: '10.00' },
};

const CART_WITH_GIFT_CARD: Cart = {
  ...SEEDED_CART,
  total: '4949.00',
  giftCard: { code: 'FXGIFTWELCOME100', balanceApplied: '50.00' },
};

function makeCartServiceStub(initial: Cart | Error = SEEDED_CART) {
  const itemCount = signal(initial instanceof Error ? 0 : initial.items.length);
  return {
    itemCount,
    get: vi.fn(async () => {
      if (initial instanceof Error) throw initial;
      return initial;
    }),
    addItem: vi.fn(async () => SEEDED_CART),
    updateItem: vi.fn(async (_id: string, body: { quantity: number }) => ({
      ...SEEDED_CART,
      items: SEEDED_CART.items.map((l) => ({ ...l, quantity: body.quantity })),
    })),
    removeItem: vi.fn(async () => EMPTY_CART),
    clear: vi.fn(),
    applyCoupon: vi.fn(async () => CART_WITH_COUPON),
    removeCoupon: vi.fn(async () => SEEDED_CART),
    applyGiftCard: vi.fn(async () => CART_WITH_COUPON),
    removeGiftCard: vi.fn(async () => undefined),
    estimate: vi.fn(),
    saveForLater: vi.fn(async () => EMPTY_CART),
  };
}

async function renderPage(opts: {
  locale: Locale;
  cart?: Cart | Error;
}): Promise<ComponentFixture<CartPage>> {
  TestBed.overrideComponent(CartPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  const stub = makeCartServiceStub(opts.cart ?? SEEDED_CART);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(opts.locale) },
      { provide: CartService, useValue: stub },
      { provide: WishlistStateService, useValue: { hydrate: vi.fn(async () => undefined) } },
    ],
  });
  const fixture = TestBed.createComponent(CartPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const AXE_OPTS: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  rules: {
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
  },
};

describe('CartPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders title + ready state with cart-line + totals + forms', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent?.trim().length).toBeGreaterThan(0);
    expect(root.querySelector('cart-line')).not.toBeNull();
    expect(root.querySelector('cart-totals')).not.toBeNull();
    expect(root.querySelector('cart-coupon-form')).not.toBeNull();
    expect(root.querySelector('cart-gift-card-form')).not.toBeNull();
  });

  it('renders empty state when cart is empty', async () => {
    const fixture = await renderPage({ locale: 'en', cart: EMPTY_CART });
    expect(fixture.nativeElement.querySelector('[data-testid="cart-empty"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="cart-empty-cta"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('cart-line')).toBeNull();
  });

  it('renders error state when cart.get() rejects, then retries on click', async () => {
    const stub = makeCartServiceStub(new Error('boom'));
    TestBed.overrideComponent(CartPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: CartService, useValue: stub },
        { provide: WishlistStateService, useValue: { hydrate: vi.fn(async () => undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="cart-error"]')).not.toBeNull();
    expect(stub.get).toHaveBeenCalledTimes(1);

    stub.get.mockResolvedValueOnce(SEEDED_CART);
    const retry = fixture.nativeElement.querySelector(
      '[data-testid="cart-error-retry"] button',
    ) as HTMLButtonElement;
    retry.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(stub.get).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('cart-line')).not.toBeNull();
  });

  it('renders the move-to-wishlist auth-gate when anonymous', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const gate = fixture.nativeElement.querySelector('[data-testid="cart-save-auth-gate"]');
    expect(gate).not.toBeNull();
    expect(gate?.textContent).toContain(getChromeStrings('en').cart.page.saveForLaterAuthGate);
  });

  // Finding T7. The action emptied the line and moved the product into the
  // wishlist, then said nothing at all; the "saved for later" list it implied
  // could never appear because GET /v1/cart has no such field.
  it('confirms the move with a link to the wishlist and refreshes heart state', async () => {
    const stub = makeCartServiceStub(SEEDED_CART);
    const wishlistState = { hydrate: vi.fn(async () => undefined) };
    TestBed.overrideComponent(CartPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: CartService, useValue: stub },
        {
          provide: AuthStateService,
          useValue: { isAuthed: () => true, whenBooted: async () => undefined },
        },
        { provide: WishlistStateService, useValue: wishlistState },
      ],
    });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const moveBtn = fixture.nativeElement.querySelector(
      '[data-testid="cart-line-save-line-1"] button',
    ) as HTMLButtonElement;
    moveBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(stub.saveForLater).toHaveBeenCalledWith('line-1');
    const status = fixture.nativeElement.querySelector('[data-testid="cart-move-status"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toContain(getChromeStrings('en').cart.page.movedToWishlist);
    const link = status?.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('/en/account/wishlist');
    // The cart line carries no productId on the wire, so the store re-reads
    // rather than guessing which product just became wishlisted.
    expect(wishlistState.hydrate).toHaveBeenCalled();
  });

  // The section, its component, the schema field and the restore handler were
  // all unreachable: the backend has never returned a saved-for-later pool.
  it('renders no saved-for-later section for any cart payload', async () => {
    const fixture = await renderPage({ locale: 'en' });
    expect(fixture.nativeElement.querySelector('cart-saved-for-later-list')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="cart-saved"]')).toBeNull();
  });

  it('shows applied coupon UI when cart.coupon is set', async () => {
    const fixture = await renderPage({ locale: 'en', cart: CART_WITH_COUPON });
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-coupon-applied"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-totals-discount"]'),
    ).not.toBeNull();
  });

  it('emits remove from cart-line and the page calls removeItem', async () => {
    const stub = makeCartServiceStub(SEEDED_CART);
    TestBed.overrideComponent(CartPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: CartService, useValue: stub },
        { provide: WishlistStateService, useValue: { hydrate: vi.fn(async () => undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const removeBtn = fixture.nativeElement.querySelector(
      '[data-testid="cart-line-remove-line-1"] button',
    ) as HTMLButtonElement;
    removeBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(stub.removeItem).toHaveBeenCalledWith('line-1');
  });

  it('axe — zero serious / critical violations on the ready state', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const result = await axe.run(fixture.nativeElement, AXE_OPTS);
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  it('shows loading state while cart.get() is in flight', async () => {
    const stub = makeCartServiceStub(SEEDED_CART);
    stub.get.mockImplementation(() => new Promise<never>(() => undefined));
    TestBed.overrideComponent(CartPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: CartService, useValue: stub },
        { provide: WishlistStateService, useValue: { hydrate: vi.fn(async () => undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="cart-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('cart-line')).toBeNull();
  });

  it('shows applied gift-card UI when cart.giftCard is set', async () => {
    const fixture = await renderPage({ locale: 'en', cart: CART_WITH_GIFT_CARD });
    expect(
      fixture.nativeElement.querySelector('[data-testid="cart-gift-card-applied"]'),
    ).not.toBeNull();
  });

  it('emits qtyChange from cart-line stepper and the page calls updateItem', async () => {
    const stub = makeCartServiceStub(SEEDED_CART);
    TestBed.overrideComponent(CartPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: CartService, useValue: stub },
        { provide: WishlistStateService, useValue: { hydrate: vi.fn(async () => undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const inc = fixture.nativeElement.querySelector(
      '[data-testid="cart-line-stepper-line-1"] .step.increment',
    ) as HTMLButtonElement;
    inc.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(stub.updateItem).toHaveBeenCalledWith('line-1', { quantity: 2 });
  });

  /**
   * Full-stack audit B1 row #5 — backend now emits `CART_INSUFFICIENT_STOCK`
   * when qty-update exceeds live stock. The cart page's `surfaceMutationError`
   * must map that code to the localized `mutationOutOfStock` string rather
   * than the generic mutation copy.
   */
  it('renders the localized mutationOutOfStock message when updateItem throws CART_INSUFFICIENT_STOCK', async () => {
    const stub = makeCartServiceStub(SEEDED_CART);
    stub.updateItem = vi.fn(async () => {
      throw new StorefrontValidationError({
        code: 'CART_INSUFFICIENT_STOCK',
        message: 'Insufficient stock for the requested quantity',
      });
    });
    TestBed.overrideComponent(CartPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: CartService, useValue: stub },
        { provide: WishlistStateService, useValue: { hydrate: vi.fn(async () => undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const inc = fixture.nativeElement.querySelector(
      '[data-testid="cart-line-stepper-line-1"] .step.increment',
    ) as HTMLButtonElement;
    inc.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = fixture.nativeElement.querySelector(
      '[data-testid="cart-mutation-error"]',
    ) as HTMLElement | null;
    expect(errEl?.textContent ?? '').toContain('Not enough stock available');
  });

  it('emits coupon apply from form and the page calls applyCoupon', async () => {
    const stub = makeCartServiceStub(SEEDED_CART);
    TestBed.overrideComponent(CartPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: CartService, useValue: stub },
        { provide: WishlistStateService, useValue: { hydrate: vi.fn(async () => undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector(
      '[data-testid="cart-coupon-input"]',
    ) as HTMLInputElement;
    input.value = 'FIXTURE10';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    const submit = fixture.nativeElement.querySelector(
      '[data-testid="cart-coupon-submit"] button',
    ) as HTMLButtonElement;
    submit.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(stub.applyCoupon).toHaveBeenCalledWith({ code: 'FIXTURE10' });
  });

  it('emits coupon remove from applied state and the page calls removeCoupon', async () => {
    const stub = makeCartServiceStub(CART_WITH_COUPON);
    TestBed.overrideComponent(CartPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: CartService, useValue: stub },
        { provide: WishlistStateService, useValue: { hydrate: vi.fn(async () => undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="cart-coupon-remove"] button',
    ) as HTMLButtonElement;
    btn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(stub.removeCoupon).toHaveBeenCalledTimes(1);
  });

  it('axe — zero serious / critical violations on the empty state', async () => {
    const fixture = await renderPage({ locale: 'en', cart: EMPTY_CART });
    const result = await axe.run(fixture.nativeElement, AXE_OPTS);
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
