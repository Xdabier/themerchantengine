import { describe, expect, it } from 'vitest';
import { listWishlistQuerySchema, wishlistIdsSchema, wishlistItemSchema } from './wishlist.schemas';

describe('listWishlistQuerySchema', () => {
  it('accepts pagination + sort', () => {
    expect(() =>
      listWishlistQuerySchema.parse({
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
    ).not.toThrow();
  });

  it('rejects unknown sortBy', () => {
    expect(() => listWishlistQuerySchema.parse({ sortBy: 'rating' })).toThrow();
  });

  it('rejects pageSize > 100', () => {
    expect(() => listWishlistQuerySchema.parse({ pageSize: 200 })).toThrow();
  });
});

describe('wishlistItemSchema', () => {
  it('parses a legacy nested wishlist item', () => {
    expect(() =>
      wishlistItemSchema.parse({
        id: 'wl1',
        productId: 'p1',
        product: { id: 'p1', slug: 'h', name: 'H' },
        createdAt: '2026-04-25T10:00:00Z',
      }),
    ).not.toThrow();
  });

  // Regression: the live `GET /v1/wishlist` endpoint emits a flat row per
  // item (no `id`, no nested `product`, `addedAt` rather than `createdAt`).
  // The schema must accept the flat shape and the transform must surface a
  // synthesised `product` so `wishlist-row.component.ts` bindings keep
  // resolving without a per-row adapter at the call site.
  it('parses the live flat API shape and synthesises product + createdAt', () => {
    const parsed = wishlistItemSchema.parse({
      productId: 'cmoeui1td0007cwqs0279hicm',
      productSlug: 'probe-pro-14-plus-laptop',
      // The TranslatableInterceptor resolves Translatable JSON to the
      // request locale before the wishlist response leaves the API, so the
      // wire shape on `productName` is a plain string.
      productName: 'Probe Pro 14 Plus Laptop',
      price: '2999',
      availableStock: 5,
      addedAt: '2026-04-28T18:00:00.000Z',
    });
    expect(parsed.product.slug).toBe('probe-pro-14-plus-laptop');
    expect(parsed.product.id).toBe('cmoeui1td0007cwqs0279hicm');
    expect(parsed.product.minPrice).toBe('2999');
    expect(parsed.createdAt).toBe('2026-04-28T18:00:00.000Z');
    expect(parsed.product.variants).toEqual([]);
    expect(parsed.product.primaryAsset).toBeNull();
  });
  // The row's image and its Add-to-cart both live on these two fields. Until
  // the API emitted them the transform hardcoded `primaryAsset: null` and
  // `variants: []`, so every row showed the branded placeholder and the
  // primary action threw before any request left the browser.
  it('surfaces the flat primaryAsset the API emits onto the synthesised product', () => {
    const parsed = wishlistItemSchema.parse({
      productId: 'p1',
      productSlug: 'probe-brush',
      productName: 'Probe brush',
      price: '19.900',
      availability: 'IN_STOCK',
      variantId: 'v1',
      primaryAsset: {
        id: 'a1',
        assetId: 'a1',
        url: 'https://cdn.test/small.webp',
        type: 'IMAGE',
        isPrimary: true,
        sortOrder: 0,
        assetVariants: [{ url: 'https://cdn.test/small.webp', width: 400, format: 'webp' }],
      },
      addedAt: '2026-08-29T10:00:00.000Z',
    });

    expect(parsed.product.primaryAsset?.url).toBe('https://cdn.test/small.webp');
    expect(parsed.variantId).toBe('v1');
    expect(parsed.availability).toBe('IN_STOCK');
  });

  it('keeps a null primaryAsset null rather than inventing one', () => {
    const parsed = wishlistItemSchema.parse({
      productId: 'p1',
      primaryAsset: null,
      variantId: null,
    });

    expect(parsed.product.primaryAsset).toBeNull();
    expect(parsed.variantId).toBeNull();
  });

  // A client running against an API that predates the additive fields must
  // still parse, or the whole page 500s on a rollback.
  it('parses a row that carries neither of the new fields', () => {
    const parsed = wishlistItemSchema.parse({
      productId: 'p1',
      productSlug: 's',
      productName: 'n',
    });

    expect(parsed.product.primaryAsset).toBeNull();
    expect(parsed.variantId ?? null).toBeNull();
  });
});

// `GET /v1/wishlist/ids` is the membership hydration source: one call per
// session that tells every heart on the page whether it is pressed.
describe('wishlistIdsSchema', () => {
  it('parses the productIds payload', () => {
    expect(wishlistIdsSchema.parse({ productIds: ['p1', 'p2'] })).toEqual({
      productIds: ['p1', 'p2'],
    });
  });

  it('parses an empty wishlist', () => {
    expect(wishlistIdsSchema.parse({ productIds: [] })).toEqual({ productIds: [] });
  });

  it('rejects a payload with no productIds array', () => {
    expect(() => wishlistIdsSchema.parse({})).toThrow();
    expect(() => wishlistIdsSchema.parse({ productIds: 'p1' })).toThrow();
  });
});
