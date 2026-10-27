import { describe, expect, it } from 'vitest';

import { fixtureMoney, STORE_CONFIG_FIXTURE_IDS } from '../test-support/store-config-fixtures';
import { formatMoney, moneyFractionDigits, type MoneyFormat } from './money';

/**
 * The price contract, now stated once per install rather than once per client.
 *
 * Everything a rendered amount depends on comes from the `money` group of the
 * runtime config, so this spec asserts the *rule* under each scenario fixture
 * instead of one store's strings: the configured separators appear where the
 * config says, the symbol sits on the configured side, and the fraction count
 * is the configured precision.
 *
 * Asserted as exact whole strings. The previous generation of this contract
 * was a fragment match, and a fragment match on a money string stays green
 * through every wrong intermediate: `1 990,00` is a substring of the correct
 * `1 990,000`. That lesson is the reason the assertions below are equalities.
 */

// Built from codepoints, never typed as literals. Both characters are
// invisible in a source file, so an editor or a tool that normalises
// whitespace can turn them into U+0020 without changing how the line looks,
// which silently converts an assertion into one that passes on the wrong
// string. Two of the three fixtures group with U+202F, so this still matters.
const NNBSP = String.fromCodePoint(0x202f);
const NBSP = String.fromCodePoint(0x00a0);

const demo = fixtureMoney('demo');
const gulf = fixtureMoney('gulf-rtl');
const maghreb = fixtureMoney('maghreb-ltr');

/** The three fixtures pin exactly the axes a money format can differ on. */
describe('the fixtures cover the axes that matter', () => {
  it('differ in precision, separators and symbol side', () => {
    expect(demo.thousandsSeparator).toBe(NNBSP);
    expect(gulf.thousandsSeparator).toBe(',');
    expect(maghreb.displayPrecision).toBe(3);
    expect(demo.displayPrecision).toBe(2);
    expect(gulf.symbolPosition).toBe('before');
    expect(demo.symbolPosition).toBe('after');
  });
});

describe('formatMoney', () => {
  it('renders the demo format: NNBSP groups, comma decimal, symbol after', () => {
    expect(formatMoney(1240, demo)).toBe(`1${NNBSP}240,00${NBSP}${demo.symbol}`);
  });

  it('renders the three-decimal format at three digits, never two', () => {
    expect(formatMoney(1240, maghreb)).toBe(`1${NNBSP}240,000${NBSP}${maghreb.symbol}`);
    expect(formatMoney(1990, maghreb)).toBe(`1${NNBSP}990,000${NBSP}${maghreb.symbol}`);
  });

  it('puts the symbol before the number when the config says so', () => {
    expect(formatMoney(1240, gulf)).toBe(`${gulf.symbol}${NBSP}1,240.00`);
  });

  it('keeps the configured fraction count on a whole amount', () => {
    expect(formatMoney(50, maghreb)).toBe(`50,000${NBSP}${maghreb.symbol}`);
    expect(formatMoney(50, demo)).toBe(`50,00${NBSP}${demo.symbol}`);
  });

  it('groups every three digits, however long the number', () => {
    expect(formatMoney(1234567, gulf)).toBe(`${gulf.symbol}${NBSP}1,234,567.00`);
  });

  it('does not group a four-digit fraction of a number below a thousand', () => {
    expect(formatMoney(999.5, maghreb)).toBe(`999,500${NBSP}${maghreb.symbol}`);
  });

  it('rounds half away from zero at the configured precision', () => {
    expect(formatMoney(1.2345, maghreb)).toBe(`1,235${NBSP}${maghreb.symbol}`);
    expect(formatMoney(1.2344, maghreb)).toBe(`1,234${NBSP}${maghreb.symbol}`);
  });

  it('renders a negative amount with the sign leading', () => {
    expect(formatMoney(-1240.5, maghreb)).toBe(`-1${NNBSP}240,500${NBSP}${maghreb.symbol}`);
  });

  it('uses the configured currency when the row carries none', () => {
    expect(formatMoney(1240, maghreb, null)).toBe(formatMoney(1240, maghreb));
    expect(formatMoney(1240, maghreb, undefined)).toBe(formatMoney(1240, maghreb));
    expect(formatMoney(1240, maghreb, maghreb.currencyCode)).toBe(formatMoney(1240, maghreb));
  });

  it('renders a non-finite amount as zero rather than NaN', () => {
    // A length-only assertion on a totals row passes on the string "NaN".
    // This is the guard that makes such a row impossible.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatMoney(bad, maghreb)).toBe(`0,000${NBSP}${maghreb.symbol}`);
    }
  });

  it('honours a historical currency recorded on a row, at its own precision', () => {
    // An order placed before a currency change keeps the currency it was
    // placed in, renders at that currency's ISO precision, and shows its code
    // rather than the store symbol, which would misprice the row.
    expect(formatMoney(1240, maghreb, 'EUR')).toBe(`1${NNBSP}240,00${NBSP}EUR`);
    expect(formatMoney(1240, gulf, 'JPY')).toBe(`JPY${NBSP}1,240`);
  });

  /**
   * The regression this file exists for, generalised.
   *
   * A search card once rendered every price as `0,000` because the payload
   * field had been renamed underneath it. A substring scan for that string
   * cannot catch it, since a real price of fifty renders as `50,000` in a
   * three-decimal currency and contains it. What actually distinguishes the
   * bug is that a non-zero amount renders as zero, so that is what is asserted,
   * under every fixture rather than the one whose precision made the string.
   */
  it.each(STORE_CONFIG_FIXTURE_IDS)('renders a non-zero amount as non-zero under %s', (id) => {
    const money: MoneyFormat = fixtureMoney(id);
    const zero = formatMoney(0, money);
    for (const amount of [0.5, 50, 1990.25]) {
      expect(formatMoney(amount, money)).not.toBe(zero);
    }
    expect(formatMoney(0, money)).toBe(zero);
  });
});

describe('moneyFractionDigits', () => {
  it('reports the configured precision for the store currency', () => {
    expect(moneyFractionDigits(maghreb)).toBe(3);
    expect(moneyFractionDigits(demo)).toBe(2);
    expect(moneyFractionDigits(maghreb, maghreb.currencyCode)).toBe(3);
  });

  it('reports the ISO precision for a currency the store does not trade in', () => {
    expect(moneyFractionDigits(demo, 'JPY')).toBe(0);
    expect(moneyFractionDigits(maghreb, 'EUR')).toBe(2);
  });

  it('falls back to the configured precision for a code Intl refuses', () => {
    // A well-formed but unassigned code still resolves through Intl, which
    // answers 2. Only a code Intl refuses falls back to the store's own.
    expect(moneyFractionDigits(maghreb, 'X')).toBe(3);
  });
});
