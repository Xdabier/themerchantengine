import type { Prisma } from '@prisma/client';
import { currencyEntry } from '../constants/currencies.constants';

/**
 * How the running store writes an amount (DR-31, plan E1.4): the `money` block
 * of the runtime config, kept in one process-wide snapshot for the same reason
 * the locale set is (`../locale/store-locales.ts`): mail renderers, PDF
 * builders and feed processors format money outside any request scope. The
 * API's `MoneyFormatterService` loads the snapshot at boot and replaces it on
 * every `store-config.updated` event; nothing else writes it.
 */
export interface MoneyConfig {
  currencyCode: string;
  symbol: string;
  symbolPosition: 'before' | 'after';
  decimalSeparator: string;
  thousandsSeparator: string;
  /** Display precision. Storage is always `Decimal(12, 3)`. */
  displayPrecision: number;
  taxDisplay: 'HT' | 'TTC' | 'none';
  /** Standard VAT rate as a fraction. */
  vatRate: number;
}

/** The neutral config a fresh engine boots with until the settings load. */
export const NEUTRAL_MONEY: MoneyConfig = Object.freeze({
  currencyCode: 'USD',
  symbol: '$',
  symbolPosition: 'before',
  decimalSeparator: '.',
  thousandsSeparator: ',',
  displayPrecision: 2,
  taxDisplay: 'none',
  vatRate: 0,
});

/** No-break space between the amount and the symbol, so a line never breaks between them. */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

function safeNumber(value: Prisma.Decimal.Value | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

/**
 * An amount as a customer reads it, from the config alone: `1 240,000 LD`,
 * `د.إ 1,240.00`, `$ 1,240.00` (a no-break space always sits between the
 * number and the symbol). No `Intl`: the separators, the precision and
 * the symbol side are the operator's choice, not a locale's, so the same
 * amount reads the same in every language the store speaks.
 *
 * The tax mention is deliberately NOT appended here: it belongs to the copy
 * beside the amount, where an operator editing a template can see it. Use
 * `taxLabel` for it.
 */
export function formatMoney(
  value: Prisma.Decimal.Value | null | undefined,
  config: MoneyConfig,
): string {
  const amount = safeNumber(value);
  const precision = Math.min(Math.max(Math.trunc(config.displayPrecision), 0), 3);
  const fixed = Math.abs(amount).toFixed(precision);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, () => config.thousandsSeparator);
  const number = fraction ? `${grouped}${config.decimalSeparator}${fraction}` : grouped;
  const signed = amount < 0 ? `-${number}` : number;
  return config.symbolPosition === 'before'
    ? `${config.symbol}${NO_BREAK_SPACE}${signed}`
    : `${signed}${NO_BREAK_SPACE}${config.symbol}`;
}

/** The mention beside a catalogue price: `HT`, `TTC`, or nothing. */
export function taxLabel(config: Pick<MoneyConfig, 'taxDisplay'>): string {
  return config.taxDisplay === 'none' ? '' : config.taxDisplay;
}

/**
 * The store's money config, applied to a row that carries its own currency
 * (an order, a gift card). When the codes agree the store config is used
 * whole; when they differ the catalogue supplies that currency's symbol and
 * precision and the store keeps its separators and symbol side, so an old
 * order in a retired currency still reads as money.
 */
export function moneyConfigFor(code: string | null | undefined, store: MoneyConfig): MoneyConfig {
  if (!code || code === store.currencyCode) return store;
  const entry = currencyEntry(code);
  return {
    ...store,
    currencyCode: code,
    symbol: entry?.symbol ?? code,
    displayPrecision: entry?.decimalPlaces ?? store.displayPrecision,
  };
}

export class StoreMoney {
  private snapshot: MoneyConfig;

  constructor(initial: MoneyConfig = NEUTRAL_MONEY) {
    this.snapshot = normaliseMoney(initial);
  }

  current(): MoneyConfig {
    return this.snapshot;
  }

  set(next: MoneyConfig): void {
    this.snapshot = normaliseMoney(next);
  }

  /** Formats in the store currency, or in the row's own when one is given. */
  format(value: Prisma.Decimal.Value | null | undefined, currencyCode?: string | null): string {
    return formatMoney(value, moneyConfigFor(currencyCode, this.snapshot));
  }

  taxLabel(): string {
    return taxLabel(this.snapshot);
  }

  currencyCode(): string {
    return this.snapshot.currencyCode;
  }
}

/** Keeps a snapshot usable whatever a settings row holds. */
export function normaliseMoney(config: MoneyConfig): MoneyConfig {
  const currencyCode = /^[A-Z]{3}$/.test(config.currencyCode)
    ? config.currencyCode
    : NEUTRAL_MONEY.currencyCode;
  const decimal = config.decimalSeparator || NEUTRAL_MONEY.decimalSeparator;
  let thousands = config.thousandsSeparator ?? NEUTRAL_MONEY.thousandsSeparator;
  if (thousands === decimal) thousands = decimal === ',' ? '.' : ',';
  const precision = Number.isInteger(config.displayPrecision)
    ? Math.min(Math.max(config.displayPrecision, 0), 3)
    : NEUTRAL_MONEY.displayPrecision;
  return Object.freeze({
    currencyCode,
    symbol: config.symbol || currencyCode,
    symbolPosition: config.symbolPosition === 'after' ? 'after' : 'before',
    decimalSeparator: decimal,
    thousandsSeparator: thousands,
    displayPrecision: precision,
    taxDisplay:
      config.taxDisplay === 'HT' || config.taxDisplay === 'TTC' ? config.taxDisplay : 'none',
    vatRate:
      typeof config.vatRate === 'number' && config.vatRate >= 0 && config.vatRate <= 1
        ? config.vatRate
        : 0,
  });
}

/** The one snapshot the running process formats against. */
export const storeMoney = new StoreMoney();
