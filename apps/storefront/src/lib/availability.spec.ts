import { describe, expect, it } from 'vitest';

import { productAvailability, variantAvailability } from './availability';

/**
 * These two helpers exist to survive a payload that is missing the field they
 * read, so the contract worth pinning is the degenerate input, not the happy
 * one. Every product card in the app renders through `productAvailability`, and
 * agent_docs/storefront/brand-tokens.md keeps availability visible without a click, so a throw here
 * is a blank card rather than a caught error.
 */
describe('variantAvailability', () => {
  it('returns the grade the server already computed', () => {
    expect(variantAvailability({ availability: 'LOW_STOCK' })).toBe('LOW_STOCK');
    expect(variantAvailability({ availability: 'IN_STOCK' })).toBe('IN_STOCK');
    expect(variantAvailability({ availability: 'OUT_OF_STOCK' })).toBe('OUT_OF_STOCK');
  });

  it('prefers the grade over the count when both are present', () => {
    // A count says "some", the grade says "nearly none". The server owns the
    // threshold, so the grade wins.
    expect(variantAvailability({ availability: 'LOW_STOCK', stock: 400 })).toBe('LOW_STOCK');
  });

  it('falls back to a truthful binary when the grade is absent', () => {
    expect(variantAvailability({ stock: 3 })).toBe('IN_STOCK');
    expect(variantAvailability({ stock: 0 })).toBe('OUT_OF_STOCK');
  });

  it('treats a null variant and an empty variant as out of stock, never throwing', () => {
    expect(variantAvailability(null)).toBe('OUT_OF_STOCK');
    expect(variantAvailability({})).toBe('OUT_OF_STOCK');
    expect(variantAvailability({ availability: null, stock: null })).toBe('OUT_OF_STOCK');
  });
});

describe('productAvailability', () => {
  it('takes the best state across the variants', () => {
    expect(
      productAvailability([{ availability: 'OUT_OF_STOCK' }, { availability: 'IN_STOCK' }]),
    ).toBe('IN_STOCK');
    expect(
      productAvailability([{ availability: 'OUT_OF_STOCK' }, { availability: 'LOW_STOCK' }]),
    ).toBe('LOW_STOCK');
    expect(
      productAvailability([{ availability: 'OUT_OF_STOCK' }, { availability: 'OUT_OF_STOCK' }]),
    ).toBe('OUT_OF_STOCK');
  });

  it('ranks in stock above low, and low above out', () => {
    expect(
      productAvailability([
        { availability: 'LOW_STOCK' },
        { availability: 'IN_STOCK' },
        { availability: 'OUT_OF_STOCK' },
      ]),
    ).toBe('IN_STOCK');
  });

  it('does not sum counts across variants', () => {
    // Two variants that are each individually low do not add up to a stocked
    // product: a customer buys one variant, not the sum of both. The search
    // endpoint rolls up the same way, so one product cannot read differently
    // on the catalogue grid than on the search grid.
    expect(
      productAvailability([{ availability: 'LOW_STOCK' }, { availability: 'LOW_STOCK' }]),
    ).toBe('LOW_STOCK');
  });

  it('is out of stock for an absent, null, or empty variant list, never throwing', () => {
    expect(productAvailability(undefined)).toBe('OUT_OF_STOCK');
    expect(productAvailability(null)).toBe('OUT_OF_STOCK');
    expect(productAvailability([])).toBe('OUT_OF_STOCK');
  });
});
