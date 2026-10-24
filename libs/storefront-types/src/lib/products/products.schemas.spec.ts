import { describe, expect, it } from 'vitest';
import {
  listProductsQuerySchema,
  productDetailSchema,
  productSummarySchema,
} from './products.schemas';

describe('listProductsQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(() => listProductsQuerySchema.parse({})).not.toThrow();
  });

  it('accepts a fully populated query', () => {
    expect(() =>
      listProductsQuerySchema.parse({
        page: 2,
        pageSize: 24,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        categoryId: 'cat_electronics',
        brand: 'Acme',
        tags: 'sale,new',
        minPrice: 0,
        maxPrice: 500,
        isFeatured: true,
      }),
    ).not.toThrow();
  });

  it('accepts the fractional bounds the catalogue price bands actually send', () => {
    // The bands are half-open by a millime — `under50` is `max: 49.999` — so
    // that the four of them partition the range with neither a dead zone nor
    // an overlap. An `.int()` here rejects three of the four outright, and
    // the catalogue page swallows the throw and renders an empty grid with no
    // error, permanently. The band map alone cannot catch that: its own spec
    // asserts what the component EMITS and never parses it.
    for (const bound of [49.999, 249.999, 999.999]) {
      expect(() => listProductsQuerySchema.parse({ maxPrice: bound })).not.toThrow();
    }
    expect(() => listProductsQuerySchema.parse({ minPrice: 50, maxPrice: 249.999 })).not.toThrow();
  });

  it('rejects a bound finer than the currency can express', () => {
    // The gate moves rather than disappearing: three decimals is the millime,
    // a fourth is not a price.
    expect(() => listProductsQuerySchema.parse({ maxPrice: 49.9999 })).toThrow();
  });

  it('rejects negative price', () => {
    expect(() => listProductsQuerySchema.parse({ minPrice: -1 })).toThrow();
  });

  it('rejects pageSize > 100', () => {
    expect(() => listProductsQuerySchema.parse({ pageSize: 200 })).toThrow();
  });

  it('rejects invalid sortOrder', () => {
    expect(() => listProductsQuerySchema.parse({ sortOrder: 'reverse' })).toThrow();
  });
});

describe('productSummarySchema', () => {
  it('parses a minimal summary', () => {
    expect(() =>
      productSummarySchema.parse({ id: 'p1', slug: 'headphones', name: 'Headphones' }),
    ).not.toThrow();
  });

  it('parses a translatable name', () => {
    expect(() =>
      productSummarySchema.parse({
        id: 'p1',
        slug: 'headphones',
        name: { default: 'Casque', fr: 'Casque', en: 'Headphones' },
      }),
    ).not.toThrow();
  });

  it('rejects when id is empty', () => {
    expect(() => productSummarySchema.parse({ id: '', slug: 'x', name: 'x' })).toThrow();
  });
});

describe('productDetailSchema', () => {
  it('parses a detail payload with variants and assets', () => {
    expect(() =>
      productDetailSchema.parse({
        id: 'p1',
        slug: 'headphones',
        name: { default: 'Casque', fr: 'Casque', en: 'Headphones' },
        variants: [{ id: 'v1', price: 199 }],
        assets: [{ id: 'a1', type: 'IMAGE', url: 'https://cdn.example/headphones.webp' }],
        faqs: [],
        categories: [],
      }),
    ).not.toThrow();
  });

  it('rejects when variants is not an array', () => {
    expect(() =>
      productDetailSchema.parse({
        id: 'p1',
        slug: 'headphones',
        name: 'Headphones',
        variants: 'oops',
      }),
    ).toThrow();
  });
});

describe('variant availability', () => {
  function detailWithVariant(variant: Record<string, unknown>) {
    return {
      id: 'p1',
      slug: 'fraise-diamant',
      name: { default: 'Fraise diamant', fr: 'Fraise diamant', en: 'Diamond bur' },
      variants: [variant],
      assets: [],
      faqs: [],
      categories: [],
    };
  }

  it('round trips each of the three states', () => {
    for (const availability of ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const) {
      const parsed = productDetailSchema.parse(
        detailWithVariant({ id: 'v1', price: 199, stock: 4, availability }),
      );
      expect(parsed.variants[0].availability).toBe(availability);
      expect(parsed.variants[0].stock).toBe(4);
    }
  });

  it('rejects a literal outside the three states', () => {
    // `.passthrough()` would have let this through as an unchecked string,
    // and the state colour would then resolve to nothing.
    expect(() =>
      productDetailSchema.parse(
        detailWithVariant({ id: 'v1', price: 199, availability: 'BACKORDER' }),
      ),
    ).toThrow();
  });

  it('rejects a lowercased literal', () => {
    expect(() =>
      productDetailSchema.parse(
        detailWithVariant({ id: 'v1', price: 199, availability: 'in_stock' }),
      ),
    ).toThrow();
  });

  it('still parses a variant that predates the field', () => {
    const parsed = productDetailSchema.parse(detailWithVariant({ id: 'v1', price: 199 }));
    expect(parsed.variants[0].availability).toBeUndefined();
  });

  it('accepts the rolled-up availability a search hit carries', () => {
    const parsed = productSummarySchema.parse({
      id: 'p1',
      slug: 'fraise-diamant',
      name: 'Fraise diamant',
      inStock: true,
      availability: 'LOW_STOCK',
    });
    expect(parsed.availability).toBe('LOW_STOCK');
  });

  it('rejects an invalid rolled-up availability', () => {
    expect(() =>
      productSummarySchema.parse({
        id: 'p1',
        slug: 'fraise-diamant',
        name: 'Fraise diamant',
        availability: 'MAYBE',
      }),
    ).toThrow();
  });
});
