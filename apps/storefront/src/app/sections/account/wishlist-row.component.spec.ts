import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { WishlistItem } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { WishlistRowComponent } from './wishlist-row.component';

const baseItem = {
  id: 'wl-1',
  productId: 'p-1',
  createdAt: '2026-04-25T10:00:00Z',
  variantId: 'v-1',
  availability: 'IN_STOCK',
  product: {
    id: 'p-1',
    slug: 'fx-headphones',
    name: { default: 'Headphones', en: 'Headphones', fr: 'Casque' },
    primaryAsset: { url: '/uploads/headphones.jpg', isPrimary: true },
    minPrice: '199.00',
    currency: 'AED',
    variants: [],
  },
} as unknown as WishlistItem;

function itemWith(overrides: Record<string, unknown>): WishlistItem {
  return { ...baseItem, ...overrides } as unknown as WishlistItem;
}

describe('WishlistRowComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders the localized product name + price + image', async () => {
    const fixture = await renderComponent(WishlistRowComponent, { item: baseItem }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('.name-link')?.textContent?.trim()).toBe('Casque');
    expect(fixture.nativeElement.querySelector('app-picture')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-price')).not.toBeNull();
  });

  it('routes the product link to the product page in the active locale', async () => {
    const fixture = await renderComponent(WishlistRowComponent, { item: baseItem }, [
      provideRouter([]),
      LocaleService,
    ]);
    const link = fixture.nativeElement.querySelector('.name-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('/fr/catalog/product/fx-headphones');
  });

  it('emits addToCart with the item on add click', async () => {
    const fixture = await renderComponent(WishlistRowComponent, { item: baseItem }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received: WishlistItem | null = null;
    fixture.componentInstance.addToCart.subscribe((v: WishlistItem) => {
      received = v;
    });
    const btn = fixture.nativeElement.querySelector(
      `[data-testid="wishlist-row-add-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;
    btn.click();
    expect(received).toBe(baseItem);
  });

  it('emits remove with the item on remove click', async () => {
    const fixture = await renderComponent(WishlistRowComponent, { item: baseItem }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received: WishlistItem | null = null;
    fixture.componentInstance.remove.subscribe((v: WishlistItem) => {
      received = v;
    });
    const btn = fixture.nativeElement.querySelector(
      `[data-testid="wishlist-row-remove-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;
    btn.click();
    expect(received).toBe(baseItem);
  });

  // The badge used to read `product.variants[]`, which the wishlist wire has
  // never carried, so it could not render for any row on any store. The grade
  // is what the API emits, and it is the same one the product page shows.
  it('marks the row out-of-stock from the availability grade and disables add to cart', async () => {
    const fixture = await renderComponent(
      WishlistRowComponent,
      { item: itemWith({ availability: 'OUT_OF_STOCK' }) },
      [provideRouter([]), LocaleService],
    );
    expect(fixture.nativeElement.querySelector('[data-testid="wishlist-row-oos"]')).not.toBeNull();
    const addBtn = fixture.nativeElement.querySelector(
      `[data-testid="wishlist-row-add-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('renders the low-stock pill and keeps add to cart usable', async () => {
    const fixture = await renderComponent(
      WishlistRowComponent,
      { item: itemWith({ availability: 'LOW_STOCK' }) },
      [provideRouter([]), LocaleService],
    );
    const pill = fixture.nativeElement.querySelector('[data-testid="wishlist-row-availability"]');
    expect(pill?.getAttribute('data-state')).toBe('low');
    expect(pill?.textContent?.trim()).toBe(
      TestBed.inject(LocaleService).strings().product.stock.lowStock,
    );
    const addBtn = fixture.nativeElement.querySelector(
      `[data-testid="wishlist-row-add-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
  });

  it('renders the in-stock pill for a stocked row', async () => {
    const fixture = await renderComponent(WishlistRowComponent, { item: baseItem }, [
      provideRouter([]),
      LocaleService,
    ]);
    const pill = fixture.nativeElement.querySelector('[data-testid="wishlist-row-availability"]');
    expect(pill?.getAttribute('data-state')).toBe('in');
    expect(pill?.textContent?.trim()).toBe(
      TestBed.inject(LocaleService).strings().product.stock.inStock,
    );
  });

  // Nothing to buy means the primary action cannot succeed. Disabling it is
  // the honest state; the old code rendered it enabled and threw on click.
  it('disables add to cart when the row carries no purchasable variant', async () => {
    const fixture = await renderComponent(
      WishlistRowComponent,
      { item: itemWith({ variantId: null }) },
      [provideRouter([]), LocaleService],
    );
    const addBtn = fixture.nativeElement.querySelector(
      `[data-testid="wishlist-row-add-${baseItem.productId}"] button`,
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('feeds the primary asset url to the picture rather than the no-image fallback', async () => {
    const fixture = await renderComponent(WishlistRowComponent, { item: baseItem }, [
      provideRouter([]),
      LocaleService,
    ]);
    const img = fixture.nativeElement.querySelector('app-picture img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('/uploads/headphones.jpg');
  });

  it('links the row image to the product page without stealing a second tab stop', async () => {
    const fixture = await renderComponent(WishlistRowComponent, { item: baseItem }, [
      provideRouter([]),
      LocaleService,
    ]);
    const imageLink = fixture.nativeElement.querySelector('a.image') as HTMLAnchorElement;
    expect(imageLink.getAttribute('href')).toContain('/fr/catalog/product/fx-headphones');
    expect(imageLink.getAttribute('tabindex')).toBe('-1');
    expect(imageLink.getAttribute('aria-hidden')).toBe('true');
  });

  it('axe — zero serious / critical violations', async () => {
    const fixture = await renderComponent(WishlistRowComponent, { item: baseItem }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['region', 'landmark-one-main', 'page-has-heading-one'],
    });
  });
});
