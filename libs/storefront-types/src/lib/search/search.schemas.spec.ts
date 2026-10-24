import { describe, expect, it } from 'vitest';
import {
  filtersQuerySchema,
  logClickRequestSchema,
  searchHitSchema,
  searchProductsQuerySchema,
  suggestQuerySchema,
  suggestResponseSchema,
} from './search.schemas';

describe('searchProductsQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(() => searchProductsQuerySchema.parse({})).not.toThrow();
  });

  it('accepts a fully populated query', () => {
    expect(() =>
      searchProductsQuerySchema.parse({
        q: 'wireless headphones',
        categoryId: 'cat1',
        priceMin: 0,
        priceMax: 500,
        inStock: true,
        rating: 4,
        sortBy: 'relevance',
        sortOrder: 'desc',
        brand: 'Acme',
        page: 1,
        pageSize: 20,
      }),
    ).not.toThrow();
  });

  it('rejects q > 200 chars', () => {
    expect(() => searchProductsQuerySchema.parse({ q: 'a'.repeat(201) })).toThrow();
  });

  it('rejects rating out of range', () => {
    expect(() => searchProductsQuerySchema.parse({ rating: 6 })).toThrow();
  });

  it('rejects unknown sortBy', () => {
    expect(() => searchProductsQuerySchema.parse({ sortBy: 'popularity' })).toThrow();
  });
});

describe('suggestQuerySchema', () => {
  it('accepts a non-empty query', () => {
    expect(() => suggestQuerySchema.parse({ q: 'head' })).not.toThrow();
  });

  it('rejects empty q', () => {
    expect(() => suggestQuerySchema.parse({ q: '' })).toThrow();
  });
});

describe('filtersQuerySchema', () => {
  it('accepts empty query', () => {
    expect(() => filtersQuerySchema.parse({})).not.toThrow();
  });
});

describe('logClickRequestSchema', () => {
  it('accepts a valid click event', () => {
    expect(() =>
      logClickRequestSchema.parse({ clickedProductId: 'p1', clickPosition: 0 }),
    ).not.toThrow();
  });

  it('rejects negative click position', () => {
    expect(() =>
      logClickRequestSchema.parse({ clickedProductId: 'p1', clickPosition: -1 }),
    ).toThrow();
  });

  it('rejects empty productId', () => {
    expect(() => logClickRequestSchema.parse({ clickedProductId: '', clickPosition: 0 })).toThrow();
  });
});

describe('searchHitSchema', () => {
  it('parses a hit with product + score', () => {
    expect(() =>
      searchHitSchema.parse({
        product: { id: 'p1', slug: 'a', name: 'A' },
        score: 0.97,
      }),
    ).not.toThrow();
  });

  // The test above is the shape this file used to rely on for the search hit, and
  // on its own it is worth nothing: three fields, asserted only for the absence of
  // a throw, so it stayed green for as long as the schema declared `priceMin`
  // while the API sent `minPrice`. The field-name contract is pinned in
  // `search-wire.spec.ts`, against a captured response body. Keep it in mind
  // before treating a green here as coverage of the wire.
  it('carries the price the search serializer actually sends', () => {
    const parsed = searchHitSchema.parse({
      product: { id: 'p1', slug: 'a', name: 'A', minPrice: 48, avgRating: 4.5, reviewCount: 2 },
    });
    expect(parsed.product.minPrice).toBe(48);
    expect(parsed.product.avgRating).toBe(4.5);
    expect(parsed.product.reviewCount).toBe(2);
  });
});

describe('suggestResponseSchema', () => {
  it('parses a list of suggestions', () => {
    expect(() =>
      suggestResponseSchema.parse([{ label: 'headphones' }, { label: 'tablet', slug: 'tab' }]),
    ).not.toThrow();
  });

  it('accepts the type discriminator on each suggestion', () => {
    expect(() =>
      suggestResponseSchema.parse([
        { type: 'product', label: 'Laptop', slug: 'fx-laptop-pro' },
        { type: 'category', label: 'Electronics', slug: 'fx-electronics' },
      ]),
    ).not.toThrow();
  });

  it('rejects an unknown discriminator value', () => {
    expect(() =>
      suggestResponseSchema.parse([{ type: 'banner', label: 'Sale', slug: 'sale' }]),
    ).toThrow();
  });
});
