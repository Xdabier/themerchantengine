import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LocaleService } from '../../locale.service';
import type { ProductCardData } from '../../ui/product-card.component';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { RelatedProductsComponent } from './related-products.component';

const card = (slug: string): ProductCardData => ({
  slug,
  title: `Product ${slug}`,
  href: `/en/catalog/product/${slug}`,
  imageSrc: `https://cdn.example/${slug}.jpg`,
  imageAlt: `Product ${slug}`,
  price: 199,
  currency: 'LYD',
  availability: 'IN_STOCK',
});

describe('RelatedProductsComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders one product-card per item when items provided', async () => {
    const fixture = await renderComponent(
      RelatedProductsComponent,
      { items: [card('a'), card('b'), card('c'), card('d')] },
      [provideRouter([]), LocaleService],
    );
    const cards = fixture.nativeElement.querySelectorAll('app-product-card');
    expect(cards.length).toBe(4);
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-related-products"]'),
    ).not.toBeNull();
  });

  it('renders nothing when items is empty', async () => {
    const fixture = await renderComponent(RelatedProductsComponent, { items: [] }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-related-products"]'),
    ).toBeNull();
  });

  it('passes axe with section landmark', async () => {
    const fixture = await renderComponent(RelatedProductsComponent, { items: [card('a')] }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement);
  });
});
