import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CartService, WishlistService } from '@storefront-services';
import type { WishlistItem } from '@storefront-types';

import { LocaleService } from '../../../../locale.service';
import { AuthStateService } from '../../../../services/auth-state.service';
import { WishlistStateService } from '../../../../services/wishlist-state.service';
import { getChromeStrings } from '../../../../../i18n';
import { type Locale } from '../../../../../i18n/types';
import WishlistPage from './index.page';
import { fixtureChromeIdentity } from '../../../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
  // The shared account nav derives `aria-current` from the live URL.
  readonly currentUrl = () => `/${this._locale()}/account`;
}

function makeAuth(authed: boolean) {
  return {
    isAuthed: () => authed,
    // The page awaits the boot outcome before deciding (finding N4); these
    // stubs model a boot that has already settled.
    whenBooted: async () => undefined,
    bootState: () => 'booted',
    currentUser: () => null,
    clearSession: vi.fn(),
  } as unknown as AuthStateService;
}

const baseItem = {
  id: 'wl-1',
  productId: 'p-1',
  createdAt: '2026-04-25T10:00:00Z',
  variantId: 'v-1',
  availability: 'IN_STOCK',
  product: {
    id: 'p-1',
    slug: 'fx-keyboard',
    name: { default: 'Keyboard', en: 'Keyboard', fr: 'Clavier' },
    primaryAsset: { url: '/uploads/keyboard.jpg', isPrimary: true },
    minPrice: '99',
    currency: 'AED',
    variants: [],
  },
} as unknown as WishlistItem;

interface RenderOpts {
  locale: Locale;
  authed: boolean;
  initialItems?: WishlistItem[];
  total?: number;
  listThrows?: unknown;
  cartThrows?: unknown;
}

interface RenderResult {
  fixture: ComponentFixture<WishlistPage>;
  navigateSpy: ReturnType<typeof vi.fn>;
  wishlistSvc: { list: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  wishlistState: { remove: ReturnType<typeof vi.fn> };
  cartSvc: { addItem: ReturnType<typeof vi.fn> };
}

async function renderWishlist(opts: RenderOpts): Promise<RenderResult> {
  const stub = new StubLocaleService(opts.locale);
  const auth = makeAuth(opts.authed);
  let stored: WishlistItem[] = opts.initialItems ?? [baseItem];
  const wishlistSvc = {
    list: vi.fn(async () => {
      if (opts.listThrows) throw opts.listThrows;
      return {
        data: stored,
        meta: { page: 1, pageSize: 12, total: opts.total ?? stored.length },
      };
    }),
    remove: vi.fn(async (productId: string) => {
      stored = stored.filter((it) => it.productId !== productId);
    }),
  };
  // Stand-in for the shared membership store. The page removes through it so
  // hearts on other surfaces stop showing the product as wishlisted; the store
  // is what actually calls the API.
  const wishlistState = {
    isWishlisted: () => true,
    remove: vi.fn(async (productId: string) => wishlistSvc.remove(productId)),
    hydrate: vi.fn(async () => undefined),
  };
  const cartSvc = {
    addItem: vi.fn(async () => {
      if (opts.cartThrows) throw opts.cartThrows;
      return {} as never;
    }),
  };

  TestBed.overrideComponent(WishlistPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocaleService, useValue: stub },
      { provide: AuthStateService, useValue: auth },
      { provide: WishlistService, useValue: wishlistSvc },
      { provide: WishlistStateService, useValue: wishlistState },
      { provide: CartService, useValue: cartSvc },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) },
        },
      },
    ],
  });
  const router = TestBed.inject(Router);
  const navigateSpy = vi.fn(async () => true);
  router.navigateByUrl = navigateSpy as never;
  router.navigate = navigateSpy as never;

  const fixture = TestBed.createComponent(WishlistPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  // Second flush: the page now awaits the session boot outcome before it even
  // reaches its data load (finding N4), so the load settles one turn later.
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, navigateSpy, wishlistSvc, wishlistState, cartSvc };
}

describe('AccountWishlistPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the SSR shell + wishlist rows', async () => {
    const { fixture } = await renderWishlist({ locale: 'fr', authed: true });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="account-wishlist-page"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-testid="account-wishlist-list"] li').length).toBe(1);
  });

  it('redirects an anonymous visitor to /auth/login', async () => {
    const { navigateSpy } = await renderWishlist({ locale: 'en', authed: false });
    expect(navigateSpy).toHaveBeenCalled();
    expect(navigateSpy.mock.calls[0][0]).toContain('/en/auth/login');
  });

  it('renders the empty state when the API returns no items', async () => {
    const { fixture } = await renderWishlist({
      locale: 'en',
      authed: true,
      initialItems: [],
      total: 0,
    });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="account-wishlist-empty"]',
      ),
    ).not.toBeNull();
  });

  it('removes an item when the row remove button is clicked + re-fetches', async () => {
    const { fixture, wishlistSvc, wishlistState } = await renderWishlist({
      locale: 'en',
      authed: true,
    });
    const root = fixture.nativeElement as HTMLElement;
    const removeBtn = root.querySelector(
      `[data-testid="wishlist-row-remove-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;
    removeBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    // Through the membership store, so a heart rendered elsewhere in the same
    // session stops claiming the product is wishlisted.
    expect(wishlistState.remove).toHaveBeenCalledWith(baseItem.productId);
    expect(wishlistSvc.remove).toHaveBeenCalledWith(baseItem.productId);
    expect(wishlistSvc.list).toHaveBeenCalledTimes(2);
  });

  // The handler read `product.variants[0]`, and the wishlist wire has never
  // carried a variants list, so the primary action on every row threw before
  // any request left the browser. It posts the row's own variantId now.
  it('adds the row variant to the cart when add CTA is clicked', async () => {
    const { fixture, cartSvc } = await renderWishlist({ locale: 'en', authed: true });
    const root = fixture.nativeElement as HTMLElement;
    const addBtn = root.querySelector(
      `[data-testid="wishlist-row-add-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;
    addBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(cartSvc.addItem).toHaveBeenCalledWith({ variantId: 'v-1', quantity: 1 });
    expect(
      root.querySelector('[data-testid="account-wishlist-status"]')?.textContent?.trim(),
    ).toBeTruthy();
  });

  it('never fires a cart request for a row with no purchasable variant', async () => {
    const { fixture, cartSvc } = await renderWishlist({
      locale: 'en',
      authed: true,
      initialItems: [{ ...baseItem, variantId: null } as unknown as WishlistItem],
    });
    const root = fixture.nativeElement as HTMLElement;
    const addBtn = root.querySelector(
      `[data-testid="wishlist-row-add-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;

    expect(addBtn.disabled).toBe(true);
    addBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(cartSvc.addItem).not.toHaveBeenCalled();
    // Disabled with a visible reason on the row, not a click that errors.
    expect(root.querySelector('[data-testid="account-wishlist-mutation-error"]')).toBeNull();
  });

  it('surfaces an error when add-to-cart fails', async () => {
    const { fixture } = await renderWishlist({
      locale: 'en',
      authed: true,
      cartThrows: new Error('boom'),
    });
    const root = fixture.nativeElement as HTMLElement;
    const addBtn = root.querySelector(
      `[data-testid="wishlist-row-add-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;
    addBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="account-wishlist-mutation-error"]')).not.toBeNull();
  });
});
