import {
  MONEY_DECIMAL_PLACES,
  applyRate,
  currencyDecimalPlaces,
  formatAmount,
  lineTotal,
  roundMoney,
  sumMoney,
} from './money';
import { Prisma } from '@prisma/client';

/**
 * The engine's single rounding authority.
 *
 * Before D4 every money computation was an unrounded IEEE-754 expression, and
 * it was invisible only because the seeded tax rate was 0.0, so the product was
 * always exactly zero. Nineteen per cent makes half-millime ties systematic:
 * 0.19 x 0.050 = 0.0095, so any base ending in a 50-millime step lands on one.
 *
 * These tests pin the two properties that matter and are easy to lose in a
 * refactor: the rule is round-half-AWAY-from-zero (matching what Postgres
 * `numeric` does on write, so the stored and displayed values agree), and the
 * arithmetic is decimal rather than binary (so `0.1 + 0.2` is `0.3`).
 */
describe('roundMoney', () => {
  it('quantises to the store currency precision', () => {
    expect(MONEY_DECIMAL_PLACES).toBe(3);
    expect(roundMoney(1.23456)).toBe(1.235);
    expect(roundMoney(1.2344)).toBe(1.234);
  });

  it('rounds a half-millime tie AWAY from zero, as Postgres numeric does', () => {
    // The rule has to match the column's, or the number shown and the number
    // stored differ by a millime on every tie.
    expect(roundMoney(0.0005)).toBe(0.001);
    expect(roundMoney(2.0005)).toBe(2.001);
    expect(roundMoney(-0.0005)).toBe(-0.001);
  });

  it('computes in decimal, not binary floating point', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('accepts the string form a Decimal serialises to', () => {
    expect(roundMoney('12.3456')).toBe(12.346);
  });

  it('leaves an already-quantised value untouched', () => {
    expect(roundMoney(1240.567)).toBe(1240.567);
    expect(roundMoney(0)).toBe(0);
  });
});

describe('sumMoney', () => {
  it('rounds once at the end rather than per term', () => {
    // Three thirds of a millime sum to one millime, and would round to zero
    // if each term were quantised first.
    expect(sumMoney([0.0004, 0.0004, 0.0004])).toBe(0.001);
  });

  it('does not accumulate binary error across many terms', () => {
    const tenth = Array.from({ length: 10 }, () => 0.1);
    expect(tenth.reduce((a, b) => a + b, 0)).not.toBe(1);
    expect(sumMoney(tenth)).toBe(1);
  });

  it('sums an empty list to zero', () => {
    expect(sumMoney([])).toBe(0);
  });
});

describe('lineTotal', () => {
  it('multiplies and quantises once', () => {
    expect(lineTotal(12.345, 3)).toBe(37.035);
    expect(lineTotal('0.001', 7)).toBe(0.007);
  });

  it('does not drift on a quantity that exposes binary error', () => {
    expect(0.1 * 3).not.toBe(0.3);
    expect(lineTotal(0.1, 3)).toBe(0.3);
  });
});

describe('applyRate', () => {
  it('applies a 19 per cent rate at three-decimal precision', () => {
    expect(applyRate(1000, 0.19)).toBe(190);
    expect(applyRate(1240.567, 0.19)).toBe(235.708);
  });

  it('resolves the half-millime tie 19 per cent makes systematic', () => {
    // 0.19 x 0.050 = 0.0095, an exact tie, on every 50-millime step.
    expect(applyRate(0.05, 0.19)).toBe(0.01);
  });

  it('returns exactly zero for a zero rate, not a signed zero', () => {
    expect(applyRate(1240.567, 0)).toBe(0);
    expect(Object.is(applyRate(1240.567, 0), -0)).toBe(false);
  });
});

describe('currencyDecimalPlaces', () => {
  it('reads the ISO minor-unit count rather than assuming two', () => {
    expect(currencyDecimalPlaces('LYD')).toBe(3);
    expect(currencyDecimalPlaces('AED')).toBe(2);
    expect(currencyDecimalPlaces('JPY')).toBe(0);
  });

  it('falls back to the storage precision for a missing or malformed code, never a store literal', () => {
    expect(currencyDecimalPlaces(undefined)).toBe(MONEY_DECIMAL_PLACES);
    expect(currencyDecimalPlaces(null)).toBe(MONEY_DECIMAL_PLACES);
    expect(currencyDecimalPlaces('not-a-code')).toBe(MONEY_DECIMAL_PLACES);
  });
});

describe('formatAmount', () => {
  it('formats at the currency precision, not a hardcoded two', () => {
    expect(formatAmount(12.345, 'LYD')).toBe('12.345');
    expect(formatAmount(12.345, 'AED')).toBe('12.35');
    expect(formatAmount(1240, 'LYD')).toBe('1240.000');
  });

  it('honours a row own historical currency', () => {
    expect(formatAmount(50, 'AED')).toBe('50.00');
  });

  it('renders a non-finite or absent amount as a zero, never NaN', () => {
    expect(formatAmount(Number.NaN, 'LYD')).toBe('0.000');
    expect(formatAmount(undefined, 'LYD')).toBe('0.000');
    expect(formatAmount(null, 'LYD')).toBe('0.000');
  });

  it('accepts the string form a Decimal serialises to', () => {
    expect(formatAmount('12.3', 'LYD')).toBe('12.300');
  });

  it('accepts a Prisma Decimal, which is what a money column actually reads back as', () => {
    expect(formatAmount(new Prisma.Decimal('79.99'), 'LYD')).toBe('79.990');
    expect(formatAmount(new Prisma.Decimal('12.345'), 'LYD')).toBe('12.345');
    expect(formatAmount(new Prisma.Decimal('0'), 'LYD')).toBe('0.000');
  });
});
