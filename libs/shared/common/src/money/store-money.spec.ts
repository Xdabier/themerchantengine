import { Prisma } from '@prisma/client';
import { loadStoreConfigFixture } from '../store-config-fixtures';
import {
  NEUTRAL_MONEY,
  StoreMoney,
  formatMoney,
  moneyConfigFor,
  normaliseMoney,
  taxLabel,
  type MoneyConfig,
} from './store-money';

const NNBSP = String.fromCodePoint(0x202f);
const NBSP = String.fromCodePoint(0x00a0);

const gulf = loadStoreConfigFixture('gulf-rtl').money as MoneyConfig;
const maghreb = loadStoreConfigFixture('maghreb-ltr').money as MoneyConfig;
const demo = loadStoreConfigFixture('demo').money as MoneyConfig;

describe('formatMoney', () => {
  it('writes a three-decimal currency with the symbol after and a narrow space between groups', () => {
    expect(formatMoney(1240, maghreb)).toBe(`1${NNBSP}240,000${NBSP}LD`);
    expect(formatMoney(1240.567, maghreb)).toBe(`1${NNBSP}240,567${NBSP}LD`);
    expect(formatMoney(0.75, maghreb)).toBe(`0,750${NBSP}LD`);
  });

  it('writes a two-decimal currency with the symbol before', () => {
    expect(formatMoney(1240, gulf)).toBe(`د.إ${NBSP}1,240.00`);
    expect(formatMoney(1234567.891, gulf)).toBe(`د.إ${NBSP}1,234,567.89`);
  });

  it('writes the demo store in euros, symbol after', () => {
    expect(formatMoney(19.9, demo)).toBe(`19,90${NBSP}€`);
  });

  it('keeps the smallest unit rather than rounding it away', () => {
    expect(formatMoney(12.345, maghreb)).toBe(`12,345${NBSP}LD`);
    expect(formatMoney(new Prisma.Decimal('79.99'), maghreb)).toBe(`79,990${NBSP}LD`);
  });

  it('renders a zero amount as a real zero at the store precision: the 0,000 regression', () => {
    // A price of zero once rendered as `0,000 DT` for every product on a
    // storefront because the wire field name drifted. The formatter's own
    // contract is that zero is `0,000` in a three-decimal currency and `0.00`
    // in a two-decimal one, so a test that scans for the string cannot tell
    // the two apart; read prices numerically upstream, see the D1 finding.
    expect(formatMoney(0, maghreb)).toBe(`0,000${NBSP}LD`);
    expect(formatMoney(0, gulf)).toBe(`د.إ${NBSP}0.00`);
    expect(formatMoney(null, maghreb)).toBe(`0,000${NBSP}LD`);
    expect(formatMoney(Number.NaN, gulf)).toBe(`د.إ${NBSP}0.00`);
  });

  it('keeps the sign in front of the number, not the symbol', () => {
    expect(formatMoney(-5, gulf)).toBe(`د.إ${NBSP}-5.00`);
    expect(formatMoney(-5, maghreb)).toBe(`-5,000${NBSP}LD`);
  });

  it('accepts the string form a Decimal serialises to', () => {
    expect(formatMoney('12.3', maghreb)).toBe(`12,300${NBSP}LD`);
  });
});

describe('taxLabel', () => {
  it('returns the configured mention, or nothing', () => {
    expect(taxLabel(maghreb)).toBe('HT');
    expect(taxLabel(demo)).toBe('TTC');
    expect(taxLabel(gulf)).toBe('');
  });
});

describe('moneyConfigFor', () => {
  it('keeps the store config when the row currency agrees', () => {
    expect(moneyConfigFor('LYD', maghreb)).toBe(maghreb);
    expect(moneyConfigFor(null, maghreb)).toBe(maghreb);
  });

  it('takes symbol and precision from the catalogue for a different currency, keeping the store separators', () => {
    const cfg = moneyConfigFor('AED', maghreb);
    expect(cfg).toMatchObject({
      currencyCode: 'AED',
      symbol: 'د.إ',
      displayPrecision: 2,
      symbolPosition: 'after',
      decimalSeparator: ',',
    });
    expect(formatMoney(1240, cfg)).toBe(`1${NNBSP}240,00${NBSP}د.إ`);
  });

  it('falls back to the code itself for a currency the catalogue does not know', () => {
    expect(moneyConfigFor('XTS', maghreb).symbol).toBe('XTS');
  });
});

describe('StoreMoney', () => {
  it('boots on the neutral config and follows a set', () => {
    const money = new StoreMoney();
    expect(money.current()).toEqual(NEUTRAL_MONEY);
    expect(money.format(1240)).toBe(`$${NBSP}1,240.00`);
    money.set(maghreb);
    expect(money.format(1240)).toBe(`1${NNBSP}240,000${NBSP}LD`);
    expect(money.format(1240, 'AED')).toBe(`1${NNBSP}240,00${NBSP}د.إ`);
    expect(money.taxLabel()).toBe('HT');
    expect(money.currencyCode()).toBe('LYD');
  });

  it('never stores a config that cannot format', () => {
    const cfg = normaliseMoney({
      currencyCode: 'euros',
      symbol: '',
      symbolPosition: 'middle' as never,
      decimalSeparator: ',',
      thousandsSeparator: ',',
      displayPrecision: 9,
      taxDisplay: 'VAT' as never,
      vatRate: 19,
    });
    expect(cfg).toEqual({
      currencyCode: 'USD',
      symbol: 'USD',
      symbolPosition: 'before',
      decimalSeparator: ',',
      thousandsSeparator: '.',
      displayPrecision: 3,
      taxDisplay: 'none',
      vatRate: 0,
    });
  });
});
