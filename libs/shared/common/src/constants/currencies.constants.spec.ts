import { CURRENCIES, CURRENCY_CODES, currencyEntry } from './currencies.constants';

/**
 * The first spec this catalogue has ever had, and it exists because the
 * catalogue is a CLOSED allow-list whose absence fails silently.
 *
 * `CurrenciesService.list()` discards any stored `storefront.defaultCurrency`
 * whose code is not in `CURRENCY_CODES` and substitutes the service default.
 * So before TND was added here, writing `TND` into the settings row was read,
 * rejected, and replaced by QAR with nothing logged and no error raised —
 * every other currency edit in the phase would have been a no-op behind it.
 * `currencyEntry` returning undefined also drops `decimalPlaces` through to a
 * hardcoded `?? 2`, which truncates a three-decimal currency at the millime.
 */
describe('currencies catalogue', () => {
  it('carries the store currency with the symbol and precision the charte needs', () => {
    const tnd = currencyEntry('TND');
    expect(tnd).toBeDefined();
    // `DT`, not `د.ت`: brand-floor §3.2 puts the symbol after the number in a
    // Latin-script LTR page, and the ISO code is never rendered in its place.
    expect(tnd?.symbol).toBe('DT');
    // TND is a three-decimal currency. A 2 here silently discards the millime.
    expect(tnd?.decimalPlaces).toBe(3);
    expect(CURRENCY_CODES.has('TND')).toBe(true);
  });

  it('keeps every entry inside the range the settings clamp allows', () => {
    // `SettingsService` and the admin formatter both clamp `decimalPlaces` to
    // 0..4 before handing it to Intl, which throws outside its own range.
    for (const c of CURRENCIES) {
      expect(Number.isInteger(c.decimalPlaces)).toBe(true);
      expect(c.decimalPlaces).toBeGreaterThanOrEqual(0);
      expect(c.decimalPlaces).toBeLessThanOrEqual(4);
    }
  });

  it('records a precision that matches the ISO minor-unit count', () => {
    // Guards the class of defect this file exists to prevent: an entry added
    // with a copy-pasted `decimalPlaces: 2`. Intl carries the ISO table.
    // Collected rather than asserted per entry, so a failure names every
    // wrong row at once instead of stopping at the first.
    const mismatches = CURRENCIES.filter((c) => {
      const iso = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: c.code,
      }).resolvedOptions().maximumFractionDigits;
      return c.decimalPlaces !== iso;
    }).map((c) => `${c.code} declares ${c.decimalPlaces}`);
    expect(mismatches).toEqual([]);
  });

  it('has no duplicate codes and a code for every entry', () => {
    expect(CURRENCY_CODES.size).toBe(CURRENCIES.length);
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.symbol.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it('returns undefined for a code outside the allow-list rather than guessing', () => {
    expect(currencyEntry('ZZZ')).toBeUndefined();
    expect(CURRENCY_CODES.has('ZZZ')).toBe(false);
  });
});
