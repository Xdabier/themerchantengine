import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { ProductCardComponent, type ProductCardData } from './product-card.component';
import { assertAxeClean, renderComponent, attachToBody } from './testing';
import { getChromeStrings } from '../../i18n';

const baseData: ProductCardData = {
  slug: 'fx-business-laptop-pro-15',
  title: 'Business Laptop Pro 15',
  href: '/fr/catalog/product/fx-business-laptop-pro-15',
  imageSrc: '/uploads/assets/seed-demo/laptop/medium.webp',
  imageAlt: 'Business Laptop Pro 15',
  price: 2999,
  currency: 'AED',
  deliveryEstimate: 'Delivery in 2-3 days',
  availability: 'IN_STOCK',
};

// core.autocrlf is true on Windows checkouts, so the file on disk can carry
// CRLF. Normalise before matching, or every substring assertion below is
// green on one platform and red on the other.
const SOURCE = readFileSync(join(__dirname, 'product-card.component.ts'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

describe('ProductCardComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders title, image, link, price, delivery estimate', async () => {
    const fixture = await renderComponent(ProductCardComponent, { data: baseData });
    const title = fixture.nativeElement.querySelector('.title');
    expect(title?.textContent).toContain('Business Laptop Pro 15');
    const img = fixture.nativeElement.querySelector('img.image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(baseData.imageSrc);
    expect(img.getAttribute('alt')).toBe(baseData.imageAlt);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(fixture.nativeElement.querySelector('app-price')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.delivery')?.textContent).toContain(
      'Delivery in 2-3 days',
    );
  });

  it('reserves the delivery slot when not provided so cards stay uniform height', async () => {
    const fixture = await renderComponent(ProductCardComponent, {
      data: { ...baseData, deliveryEstimate: undefined },
    });
    // Slot is intentionally always rendered to keep all cards in a grid
    // row at the same outer height (no layout drift between cards with
    // and without a delivery estimate). Content collapses to a single
    // NBSP; the min-block-size: 1.1em rule reserves the line.
    const delivery = fixture.nativeElement.querySelector('.delivery');
    expect(delivery).not.toBeNull();
    expect((delivery?.textContent ?? '').trim()).toBe('');
    // a11y-auditor: empty delivery slot must be aria-hidden so AT does
    // not announce the layout-only NBSP.
    expect(delivery?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes delivery text to screen readers when an estimate is present', async () => {
    const fixture = await renderComponent(ProductCardComponent, { data: baseData });
    const delivery = fixture.nativeElement.querySelector('.delivery');
    expect(delivery?.getAttribute('aria-hidden')).toBeNull();
  });

  it('does not orphan the rating slot from AT when reviewCount > 0', async () => {
    const fixture = await renderComponent(ProductCardComponent, {
      data: { ...baseData, reviewCount: 12, ratingValue: 4.3 },
    });
    // a11y-auditor serious finding: the rating-slot wrapper had an
    // unconditional aria-hidden which removed the rating's role="img"
    // + aria-label from the accessibility tree. The wrapper must drop
    // aria-hidden when the rating renders.
    const slot = fixture.nativeElement.querySelector('.rating-slot');
    expect(slot?.getAttribute('aria-hidden')).toBeNull();
    expect(slot?.querySelector('app-rating')).not.toBeNull();
  });

  it('keeps the rating slot aria-hidden when the product has no reviews', async () => {
    const fixture = await renderComponent(ProductCardComponent, {
      data: { ...baseData, reviewCount: 0, ratingValue: 0 },
    });
    const slot = fixture.nativeElement.querySelector('.rating-slot');
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('passes axe with a rendered rating', async () => {
    const fixture = await renderComponent(ProductCardComponent, {
      data: { ...baseData, reviewCount: 12, ratingValue: 4.3 },
    });
    const wrapper = attachToBody(fixture.nativeElement);
    await assertAxeClean(wrapper);
  });

  it('does NOT render Rating when reviewCount is 0 (agent_docs/storefront/brand-tokens.md no-rating-when-zero)', async () => {
    const fixture = await renderComponent(ProductCardComponent, {
      data: { ...baseData, reviewCount: 0, ratingValue: 0 },
    });
    expect(fixture.nativeElement.querySelector('app-rating')).toBeNull();
  });

  it('hides Rating even when ratingValue is non-zero but reviewCount is 0 (no fake stars)', async () => {
    const fixture = await renderComponent(ProductCardComponent, {
      data: { ...baseData, reviewCount: 0, ratingValue: 4.5 },
    });
    expect(fixture.nativeElement.querySelector('app-rating')).toBeNull();
  });

  it('renders Rating when reviewCount > 0', async () => {
    const fixture = await renderComponent(ProductCardComponent, {
      data: { ...baseData, reviewCount: 12, ratingValue: 4.3 },
    });
    expect(fixture.nativeElement.querySelector('app-rating')).not.toBeNull();
  });

  it('renders compare-at price + discount badge when compareAtPrice > price', async () => {
    const fixture = await renderComponent(ProductCardComponent, {
      data: { ...baseData, price: 2400, compareAtPrice: 2999 },
    });
    expect(fixture.nativeElement.querySelector('.compare-at')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.discount-badge')).not.toBeNull();
  });

  it('passes axe on the rendered component', async () => {
    const fixture = await renderComponent(ProductCardComponent, { data: baseData });
    const wrapper = attachToBody(fixture.nativeElement);
    await assertAxeClean(wrapper);
  });

  describe('availability (agent_docs/storefront/brand-tokens.md, §9, §10 row 21)', () => {
    const stock = getChromeStrings('fr').product.stock;

    it('renders the in-stock label and its state', async () => {
      const fixture = await renderComponent(ProductCardComponent, {
        data: { ...baseData, availability: 'IN_STOCK' },
      });
      const el = fixture.nativeElement.querySelector('[data-testid="product-card-availability"]');
      expect(el?.textContent?.trim()).toBe(stock.inStock);
      expect(el?.getAttribute('data-state')).toBe('in');
    });

    it('renders the low-stock label and its state', async () => {
      const fixture = await renderComponent(ProductCardComponent, {
        data: { ...baseData, availability: 'LOW_STOCK' },
      });
      const el = fixture.nativeElement.querySelector('[data-testid="product-card-availability"]');
      expect(el?.textContent?.trim()).toBe(stock.lowStock);
      expect(el?.getAttribute('data-state')).toBe('low');
    });

    it('renders the out-of-stock label and its state', async () => {
      const fixture = await renderComponent(ProductCardComponent, {
        data: { ...baseData, availability: 'OUT_OF_STOCK' },
      });
      const el = fixture.nativeElement.querySelector('[data-testid="product-card-availability"]');
      expect(el?.textContent?.trim()).toBe(stock.outOfStock);
      expect(el?.getAttribute('data-state')).toBe('out');
    });

    it('carries the meaning as text, never as colour alone (WCAG 1.4.1)', async () => {
      const fixture = await renderComponent(ProductCardComponent, {
        data: { ...baseData, availability: 'LOW_STOCK' },
      });
      const el = fixture.nativeElement.querySelector('[data-testid="product-card-availability"]');
      // Colour is reinforcement. The label itself has to differ per state and
      // has to stay in the accessibility tree.
      expect((el?.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect(el?.getAttribute('aria-hidden')).toBeNull();
      expect(stock.lowStock).not.toBe(stock.inStock);
      expect(stock.lowStock).not.toBe(stock.outOfStock);
    });

    it('binds every state colour to a token, never a raw hex (§10 rows 1 and 7)', () => {
      expect(SOURCE).toContain("[data-state='in'] {\n        color: var(--brand-success-text);");
      expect(SOURCE).toContain("[data-state='low'] {\n        color: var(--brand-warning-text);");
      expect(SOURCE).toContain("[data-state='out'] {\n        color: var(--brand-error);");
      expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

    /**
     * Finding H5. The card promised a delivery window
     * directly under an "Out of stock" line, on home rails, catalog, search and
     * the related rail alike. A promise about a product nobody can buy is a
     * promise the store cannot keep, so the slot follows availability.
     */
    it('drops the delivery promise when the product is out of stock', async () => {
      const fixture = await renderComponent(ProductCardComponent, {
        data: { ...baseData, availability: 'OUT_OF_STOCK' },
      });
      const delivery = fixture.nativeElement.querySelector('.delivery');
      // The slot stays in the DOM: it is what keeps every card in a grid row
      // at the same outer height (the NBSP reservation above).
      expect(delivery).not.toBeNull();
      expect((delivery?.textContent ?? '').trim()).toBe('');
      expect(delivery?.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps the delivery promise on a low-stock product, which is buyable', async () => {
      const fixture = await renderComponent(ProductCardComponent, {
        data: { ...baseData, availability: 'LOW_STOCK' },
      });
      const delivery = fixture.nativeElement.querySelector('.delivery');
      expect(delivery?.textContent).toContain('Delivery in 2-3 days');
      expect(delivery?.getAttribute('aria-hidden')).toBeNull();
    });

    it('passes axe with an out-of-stock card', async () => {
      const fixture = await renderComponent(ProductCardComponent, {
        data: { ...baseData, availability: 'OUT_OF_STOCK' },
      });
      const wrapper = attachToBody(fixture.nativeElement);
      await assertAxeClean(wrapper);
    });
  });

  describe('type scale (agent_docs/storefront/brand-tokens.md)', () => {
    it('sets the subtitle tier on the card title with the display face', () => {
      const title = SOURCE.slice(SOURCE.indexOf('.title {'));
      expect(title).toContain('font-family: var(--brand-font-display);');
      expect(title).toContain('font-size: var(--brand-text-product);');
      expect(title).toContain('font-weight: 500;');
    });

    it('never shouts a label in capitals (§8.2)', () => {
      expect(SOURCE).not.toContain('text-transform: uppercase');
    });
  });
});
