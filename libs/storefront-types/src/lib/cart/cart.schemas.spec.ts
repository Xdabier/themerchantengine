import { describe, expect, it } from 'vitest';
import {
  addItemRequestSchema,
  applyCouponRequestSchema,
  applyGiftCardRequestSchema,
  cartSchema,
  estimateShippingQuerySchema,
  estimateShippingResponseSchema,
  updateItemRequestSchema,
} from './cart.schemas';

describe('addItemRequestSchema', () => {
  it('accepts valid item', () => {
    expect(() => addItemRequestSchema.parse({ variantId: 'v1', quantity: 1 })).not.toThrow();
  });

  it('rejects qty 0', () => {
    expect(() => addItemRequestSchema.parse({ variantId: 'v1', quantity: 0 })).toThrow();
  });
});

describe('updateItemRequestSchema', () => {
  it('accepts valid qty', () => {
    expect(() => updateItemRequestSchema.parse({ quantity: 3 })).not.toThrow();
  });

  it('rejects negative qty', () => {
    expect(() => updateItemRequestSchema.parse({ quantity: -1 })).toThrow();
  });
});

describe('applyCouponRequestSchema', () => {
  it.each(['SAVE10', 'NEW_USER', 'FIXTURE-2026'])('accepts %s', (code) => {
    expect(() => applyCouponRequestSchema.parse({ code })).not.toThrow();
  });

  it('rejects code with spaces', () => {
    expect(() => applyCouponRequestSchema.parse({ code: 'BAD CODE' })).toThrow();
  });

  it('rejects code > 50 chars', () => {
    expect(() => applyCouponRequestSchema.parse({ code: 'A'.repeat(51) })).toThrow();
  });
});

describe('applyGiftCardRequestSchema', () => {
  it('accepts a 16-char uppercase alnum', () => {
    expect(() => applyGiftCardRequestSchema.parse({ code: 'ABCD1234EFGH5678' })).not.toThrow();
  });

  it('accepts the whole range the API accepts, not just the generated length', () => {
    // The generator emits sixteen, but ApplyGiftCardDto and the admin
    // CreateGiftCardDto both allow 8 to 20, so an operator-issued short code
    // was rejected here before it ever reached the server, under a message
    // naming a rule the server does not have.
    expect(() => applyGiftCardRequestSchema.parse({ code: 'ABCD1234' })).not.toThrow();
    expect(() => applyGiftCardRequestSchema.parse({ code: 'ABCD1234EFGH567' })).not.toThrow();
    expect(() => applyGiftCardRequestSchema.parse({ code: 'A'.repeat(20) })).not.toThrow();
  });

  it('still rejects outside that range', () => {
    expect(() => applyGiftCardRequestSchema.parse({ code: 'ABCD123' })).toThrow();
    expect(() => applyGiftCardRequestSchema.parse({ code: 'A'.repeat(21) })).toThrow();
  });

  it('rejects lowercase', () => {
    expect(() => applyGiftCardRequestSchema.parse({ code: 'abcd1234efgh5678' })).toThrow();
  });
});

describe('estimateShippingQuerySchema', () => {
  it('accepts a country and optional postal code', () => {
    expect(() => estimateShippingQuerySchema.parse({ country: 'QA' })).not.toThrow();
    expect(() =>
      estimateShippingQuerySchema.parse({ country: 'QA', postalCode: '00974' }),
    ).not.toThrow();
  });

  it('rejects lowercase country', () => {
    expect(() => estimateShippingQuerySchema.parse({ country: 'qa' })).toThrow();
  });
});

describe('estimateShippingResponseSchema', () => {
  // The old fixture was a bare array of `{ cost, currency }`, which matched the
  // old schema and nothing else. The API has always returned an OBJECT of
  // `{ rates, taxEstimate }` whose amount is `price` and which carries no
  // per-rate currency; the three-way mismatch stayed invisible because the
  // only caller of `estimate()` was its own spec, feeding it this fixture.
  it('parses the { rates, taxEstimate } envelope the API actually returns', () => {
    const parsed = estimateShippingResponseSchema.parse({
      rates: [
        { methodId: 'dtn-sm-standard', name: { default: 'Standard' }, price: 8, isDefault: true },
        { methodId: 'sm-metro', name: { default: 'Metro area' }, price: 5 },
      ],
      taxEstimate: 19,
    });
    expect(parsed.rates).toHaveLength(2);
    expect(parsed.rates[0].price).toBe(8);
    expect(parsed.taxEstimate).toBe(19);
  });

  it('accepts a null tax estimate, which is what an unresolved zone returns', () => {
    const parsed = estimateShippingResponseSchema.parse({ rates: [], taxEstimate: null });
    expect(parsed.rates).toEqual([]);
    expect(parsed.taxEstimate).toBeNull();
  });

  it('rejects the bare array the old contract declared', () => {
    expect(() => estimateShippingResponseSchema.parse([])).toThrow();
  });
});

describe('cartSchema', () => {
  it('parses a minimal cart', () => {
    expect(() =>
      cartSchema.parse({ items: [], subtotal: 0, total: 0, currency: 'EUR' }),
    ).not.toThrow();
  });

  it('parses a cart with a coupon through couponCode plus the coupon discount line', () => {
    // The old fixture used a nested `coupon: { code, discount }` object. The
    // API has never emitted one: it sends the scalar `couponCode` and a
    // `discounts[]` entry of type 'coupon', and the storefront derives the
    // applied-coupon chip from those two.
    const parsed = cartSchema.parse({
      items: [],
      subtotal: 100,
      total: 90,
      currency: 'EUR',
      couponCode: 'SAVE10',
      discounts: [{ promotionId: '', label: 'SAVE10', amount: 10, type: 'coupon' }],
    });
    expect(parsed.couponCode).toBe('SAVE10');
    expect(parsed.discounts[0].type).toBe('coupon');
  });
});

describe('cartSchema against the shape the API actually emits', () => {
  // Every key below is one the live `CartResponse` sends. Undeclared keys
  // survive `.passthrough()` untyped, so a component could only read them
  // through a cast and no parse would ever object to a wrong type. Declaring
  // them is what turns a wire-shape drift into a parse failure.
  const liveCartResponse = {
    id: 'clr0000000000000000000000',
    items: [
      {
        id: 'clr0000000000000000000001',
        variantId: 'clr0000000000000000000002',
        productSlug: 'brosse-souple',
        productName: { default: 'Brosse souple', fr: 'Brosse souple', en: 'Soft brush' },
        variantLabel: null,
        unitPrice: 12.5,
        compareAtPrice: null,
        quantity: 2,
        lineTotal: 25,
        inStock: true,
        stockAvailable: 7,
        thumbnailUrl: '/uploads/brosse-thumb.webp',
        weight: 0.05,
      },
    ],
    subtotal: 25,
    discounts: [],
    shippingEstimate: 8,
    shippingMethodName: { default: 'Standard', fr: 'Standard', en: 'Standard' },
    taxEstimate: null,
    freeShippingProgress: { threshold: 300, remaining: 275, qualified: false },
    total: 25,
    grandTotal: 33,
    grandTotalTtc: 33,
    itemCount: 2,
    couponCode: null,
    giftCard: null,
    crossSellProductIds: [],
  };

  it('parses the live response and keeps every line field', () => {
    const parsed = cartSchema.parse(liveCartResponse);
    expect(parsed.items[0].thumbnailUrl).toBe('/uploads/brosse-thumb.webp');
    expect(parsed.items[0].stockAvailable).toBe(7);
    expect(parsed.items[0].inStock).toBe(true);
    expect(parsed.items[0].variantLabel).toBeNull();
    expect(parsed.itemCount).toBe(2);
    expect(parsed.freeShippingProgress).toEqual({
      threshold: 300,
      remaining: 275,
      qualified: false,
    });
  });

  it('rejects a mistyped thumbnailUrl instead of passing it through untyped', () => {
    const bad = {
      ...liveCartResponse,
      items: [{ ...liveCartResponse.items[0], thumbnailUrl: 42 }],
    };
    expect(() => cartSchema.parse(bad)).toThrow();
  });

  it('rejects a mistyped stockAvailable', () => {
    const bad = {
      ...liveCartResponse,
      items: [{ ...liveCartResponse.items[0], stockAvailable: 'seven' }],
    };
    expect(() => cartSchema.parse(bad)).toThrow();
  });

  it('rejects a mistyped freeShippingProgress', () => {
    const bad = { ...liveCartResponse, freeShippingProgress: { qualified: 'yes' } };
    expect(() => cartSchema.parse(bad)).toThrow();
  });

  it('accepts a null freeShippingProgress, which is what an empty cart returns', () => {
    const parsed = cartSchema.parse({ ...liveCartResponse, freeShippingProgress: null });
    expect(parsed.freeShippingProgress).toBeNull();
  });
});
