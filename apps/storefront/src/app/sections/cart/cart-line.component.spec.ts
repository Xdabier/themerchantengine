import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { CartLine } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { CartLineComponent, type CartLineQtyChange } from './cart-line.component';
import { getChromeStrings } from '../../../i18n';
import {
  fixtureRuntimeConfig,
  provideFixtureStoreConfig,
} from '../../../test-support/store-config-fixtures';

const baseLine: CartLine = {
  id: '11111111-1111-1111-1111-111111111111',
  variantId: '22222222-2222-2222-2222-222222222222',
  productSlug: 'fx-laptop-pro-16-studio',
  productName: 'Laptop Pro 16 Studio',
  primaryAsset: { url: '/uploads/laptop-pro.jpg', isPrimary: true },
  unitPrice: '4999.00',
  quantity: 2,
  lineTotal: '9998.00',
};

describe('CartLineComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders product name, image, price, line total, stepper, remove button', async () => {
    const fixture = await renderComponent(CartLineComponent, { line: baseLine }, [
      provideRouter([]),
      LocaleService,
    ]);

    expect(fixture.nativeElement.querySelector('.name')?.textContent?.trim()).toBe(
      'Laptop Pro 16 Studio',
    );
    expect(fixture.nativeElement.querySelector('app-picture')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-price')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.line-total-amount')?.textContent?.trim().length,
    ).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('app-stepper')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(`[data-testid="cart-line-remove-${baseLine.id}"]`),
    ).not.toBeNull();
  });

  it('renders the no-image fallback through app-picture when primaryAsset is missing', async () => {
    const line = { ...baseLine, primaryAsset: null };
    const fixture = await renderComponent(CartLineComponent, { line }, [
      provideRouter([]),
      LocaleService,
    ]);
    const picture = fixture.nativeElement.querySelector('app-picture');
    expect(picture).not.toBeNull();
    const img = picture?.querySelector('img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('/brand/no-image.svg');
  });

  it('renders the image from thumbnailUrl, the only image field the cart API sends', async () => {
    // `CartItemResponse.thumbnailUrl` is what `GET /v1/cart` emits per line.
    // The component read `primaryAsset`, a key the cart envelope has never
    // carried, so every line fell through to the branded no-image asset.
    const line: CartLine = { ...baseLine, primaryAsset: null, thumbnailUrl: '/uploads/thumb.webp' };
    const fixture = await renderComponent(CartLineComponent, { line }, [
      provideRouter([]),
      LocaleService,
    ]);
    const img = fixture.nativeElement.querySelector('app-picture img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('/uploads/thumb.webp');
  });

  it('falls back to the no-image asset only when thumbnailUrl is null', async () => {
    const line: CartLine = { ...baseLine, primaryAsset: null, thumbnailUrl: null };
    const fixture = await renderComponent(CartLineComponent, { line }, [
      provideRouter([]),
      LocaleService,
    ]);
    const img = fixture.nativeElement.querySelector('app-picture img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('/brand/no-image.svg');
  });

  it('emits qtyChange when stepper increments past initial', async () => {
    const fixture = await renderComponent(CartLineComponent, { line: baseLine }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received: CartLineQtyChange | null = null;
    fixture.componentInstance.qtyChange.subscribe((v: CartLineQtyChange) => {
      received = v;
    });
    const inc = fixture.nativeElement.querySelector('.step.increment') as HTMLButtonElement;
    inc.click();
    expect(received).toEqual({ itemId: baseLine.id, quantity: 3 });
  });

  it('leaves the stepper usable below the stock the API reports', async () => {
    // `max` was hardcoded 99 while the cart API sends `stockAvailable` per
    // line, so the control happily offered quantities the warehouse could not
    // fill and the only feedback was a server error after the click.
    const line: CartLine = { ...baseLine, quantity: 2, stockAvailable: 3 };
    const fixture = await renderComponent(CartLineComponent, { line }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect((fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('caps the stepper at the stock the API reports for the line', async () => {
    const line: CartLine = { ...baseLine, quantity: 3, stockAvailable: 3 };
    const fixture = await renderComponent(CartLineComponent, { line }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect((fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('keeps the 99 ceiling when the API reports no per-line stock figure', async () => {
    const line: CartLine = { ...baseLine, quantity: 2, stockAvailable: undefined };
    const fixture = await renderComponent(CartLineComponent, { line }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect((fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('disables the stepper while a cart mutation is in flight', async () => {
    // The remove and save buttons already honoured `disabled`; the stepper did
    // not even accept the input, so a shopper could queue several quantity
    // changes against one in-flight request.
    const fixture = await renderComponent(
      CartLineComponent,
      { line: { ...baseLine, stockAvailable: 10 }, disabled: true },
      [provideRouter([]), LocaleService],
    );
    expect((fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((fixture.nativeElement.querySelector('.decrement') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('renders the quantity the line holds, not the last click', async () => {
    const fixture = await renderComponent(
      CartLineComponent,
      { line: { ...baseLine, quantity: 2, stockAvailable: 10 } },
      [provideRouter([]), LocaleService],
    );
    (fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.value')?.textContent?.trim()).toBe('2');
  });

  it('emits remove with itemId when remove button is clicked', async () => {
    const fixture = await renderComponent(CartLineComponent, { line: baseLine }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received: string | null = null;
    fixture.componentInstance.remove.subscribe((v: string) => {
      received = v;
    });
    const btn = fixture.nativeElement.querySelector(
      `[data-testid="cart-line-remove-${baseLine.id}"] button`,
    ) as HTMLButtonElement;
    btn.click();
    expect(received).toBe(baseLine.id);
  });

  it('hides save-for-later button when authed=false', async () => {
    const fixture = await renderComponent(CartLineComponent, { line: baseLine, authed: false }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector(`[data-testid="cart-line-save-${baseLine.id}"]`),
    ).toBeNull();
  });

  it('emits saveForLater when authed save button is clicked', async () => {
    const fixture = await renderComponent(CartLineComponent, { line: baseLine, authed: true }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received: string | null = null;
    fixture.componentInstance.saveForLater.subscribe((v: string) => {
      received = v;
    });
    const btn = fixture.nativeElement.querySelector(
      `[data-testid="cart-line-save-${baseLine.id}"] button`,
    ) as HTMLButtonElement;
    btn.click();
    expect(received).toBe(baseLine.id);
  });

  it('axe — zero serious / critical violations', async () => {
    const fixture = await renderComponent(CartLineComponent, { line: baseLine, authed: true }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['region', 'landmark-one-main', 'page-has-heading-one'],
    });
  });

  describe('tax mention source', () => {
    // The only spec that renders this component, so the `none` and `TTC`
    // branches of `lineTaxMention` execute nowhere else: the journey runs the
    // bridge config, which displays HT.
    it('renders no mention for a store that displays none', async () => {
      const fixture = await renderComponent(CartLineComponent, { line: baseLine }, [
        provideRouter([]),
        LocaleService,
        provideFixtureStoreConfig('gulf-rtl'),
      ]);
      expect(fixtureRuntimeConfig('gulf-rtl').money.taxDisplay).toBe('none');
      expect(fixture.nativeElement.querySelector('.tax-mention')).toBeNull();
    });

    it('labels the line the way the store displays its catalogue', async () => {
      const fixture = await renderComponent(CartLineComponent, { line: baseLine }, [
        provideRouter([]),
        LocaleService,
        provideFixtureStoreConfig('demo'),
      ]);
      expect(fixtureRuntimeConfig('demo').money.taxDisplay).toBe('TTC');
      expect(fixture.nativeElement.querySelector('.tax-mention')?.textContent?.trim()).toBe(
        getChromeStrings('fr').generic.taxIncluded,
      );
    });
  });
});
