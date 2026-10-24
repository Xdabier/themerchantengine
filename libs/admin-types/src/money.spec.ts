import { MONEY_DECIMAL_PLACES, hasMoneyScale, moneySchema, moneyScaleFactor } from './money';

/**
 * The admin's money scale, which is a VALIDATION gate rather than a display
 * rule: before D4 the admin did not merely show two decimals, it rejected a
 * third, so an operator on a three-decimal currency could not enter a legal
 * millime price and the failure surfaced as a form error.
 *
 * The gate MOVES here rather than disappearing, which is the property these
 * tests exist to pin: three decimals accepted, four still rejected.
 */
describe('moneyScaleFactor', () => {
  it('is a power of ten matching the scale', () => {
    expect(moneyScaleFactor(0)).toBe(1);
    expect(moneyScaleFactor(2)).toBe(100);
    expect(moneyScaleFactor(3)).toBe(1000);
  });
});

describe('hasMoneyScale', () => {
  it('accepts a millime and rejects a fourth decimal at the store scale', () => {
    expect(MONEY_DECIMAL_PLACES).toBe(3);
    expect(hasMoneyScale(9.999)).toBe(true);
    expect(hasMoneyScale(9.9999)).toBe(false);
    expect(hasMoneyScale(12)).toBe(true);
    expect(hasMoneyScale(0)).toBe(true);
  });

  it('is parameterised by scale rather than pinned to a new literal', () => {
    // The previous validator encoded the precision in its own NAME, so a
    // currency change meant a rename plus a rewrite. This one takes the scale.
    expect(hasMoneyScale(9.99, 2)).toBe(true);
    expect(hasMoneyScale(9.999, 2)).toBe(false);
    expect(hasMoneyScale(9.9, 1)).toBe(true);
    expect(hasMoneyScale(9.99, 1)).toBe(false);
  });
});

describe('moneySchema', () => {
  it('accepts a millime-precision price', () => {
    expect(moneySchema.parse(12.345)).toBe(12.345);
    expect(moneySchema.parse(0)).toBe(0);
  });

  it('rejects a fourth decimal, with a message naming the real scale', () => {
    const result = moneySchema.safeParse(12.3456);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('At most 3 decimal places');
    }
  });

  it('rejects a negative amount', () => {
    expect(moneySchema.safeParse(-1).success).toBe(false);
  });

  it('rejects a non-number', () => {
    expect(moneySchema.safeParse('12.345').success).toBe(false);
    expect(moneySchema.safeParse(null).success).toBe(false);
    expect(moneySchema.safeParse(undefined).success).toBe(false);
  });
});
