import { adminIntlTag } from './intl-tag';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats a number in the given currency, code before amount', () => {
    expect(formatMoney(289.5, 'USD')).toBe('USD 289.50');
  });

  it('coerces the Prisma.Decimal string wire form', () => {
    expect(formatMoney('150', 'EUR')).toBe('EUR 150.00');
  });

  it('accepts a store-currency config and honours its decimalPlaces', () => {
    expect(formatMoney('1234.5', { code: 'EUR', decimalPlaces: 2 })).toBe('EUR 1,234.50');
    expect(formatMoney(1.005, { code: 'KWD', decimalPlaces: 3 })).toBe('KWD 1.005');
    expect(formatMoney(1234, { code: 'JPY', decimalPlaces: 0 })).toBe('JPY 1,234');
  });

  it('pads decimals rather than truncating them', () => {
    expect(formatMoney(6539.2, 'EUR')).toBe('EUR 6,539.20');
  });

  // D8: an unhydrated store must never fabricate a currency code.
  it('renders a bare amount when no currency is known', () => {
    expect(formatMoney(10, null)).toBe('10.00');
    expect(formatMoney(10, undefined)).toBe('10.00');
    expect(formatMoney(1234.5, null)).toBe('1,234.50');
  });

  it('returns the fallback for nullish input', () => {
    expect(formatMoney(null, 'EUR')).toBe('—');
    expect(formatMoney(undefined, 'EUR')).toBe('—');
  });

  it('returns the fallback for non-finite input', () => {
    expect(formatMoney('not-a-number', 'EUR')).toBe('—');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'EUR')).toBe('—');
  });

  it('accepts a custom fallback', () => {
    expect(formatMoney(null, 'EUR', '')).toBe('');
  });

  it('falls back to `<amount> <ISO>` for an invalid currency code', () => {
    expect(formatMoney(10, 'NOTACUR')).toBe('10.00 NOTACUR');
  });

  // decimalPlaces comes from a stored setting; Intl and toFixed both throw
  // outside their ranges, and a throw here would blank every money cell.
  it('survives a nonsense decimalPlaces from the stored config', () => {
    expect(formatMoney(10, { code: 'EUR', decimalPlaces: 1e9 })).toBe('EUR 10.0000');
    expect(formatMoney(10, { code: 'EUR', decimalPlaces: -5 })).toBe('EUR 10');
    expect(formatMoney(10, { code: 'EUR', decimalPlaces: 1.5 })).toBe('EUR 10.00');
    expect(formatMoney(10, { code: 'EUR', decimalPlaces: NaN })).toBe('EUR 10.00');
  });

  // The Intl output separates code and amount with a non-breaking space; DOM
  // greps and test assertions must not have to know that.
  it('normalises the separator to a regular space', () => {
    expect(formatMoney(10, 'EUR')).toBe('EUR 10.00');
    expect(formatMoney(10, 'EUR')).not.toMatch(/[  ]/);
  });

  // D2: deterministic across operator browsers and CI — the locale is pinned.
  it('is independent of the ambient locale', () => {
    const original = Intl.NumberFormat;
    try {
      // Any implicit `undefined` locale would pick this up; a pinned registry tag will not.
      const spy = jest.spyOn(Intl, 'NumberFormat');
      formatMoney(1234.5, 'EUR');
      expect(spy).toHaveBeenCalledWith(
        adminIntlTag(),
        expect.objectContaining({ currency: 'EUR' }),
      );
    } finally {
      Intl.NumberFormat = original;
      jest.restoreAllMocks();
    }
  });
});
