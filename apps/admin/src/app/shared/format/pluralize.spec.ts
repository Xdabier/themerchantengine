import { pluralUnit, pluralize } from './pluralize';

describe('pluralize', () => {
  it('keeps the singular for exactly one', () => {
    expect(pluralize(1, 'variant')).toBe('1 variant');
  });

  it('pluralizes every other count, zero included', () => {
    expect(pluralize(0, 'variant')).toBe('0 variants');
    expect(pluralize(2, 'variant')).toBe('2 variants');
    expect(pluralize(17, 'reference')).toBe('17 references');
  });

  it('accepts an irregular plural', () => {
    expect(pluralize(1, 'entry', 'entries')).toBe('1 entry');
    expect(pluralize(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('exposes the noun alone for sentences that phrase the count differently', () => {
    expect(pluralUnit(1, 'product')).toBe('product');
    expect(pluralUnit(4, 'product')).toBe('products');
  });
});
