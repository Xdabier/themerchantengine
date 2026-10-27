import type { StorefrontRuntimeConfig } from '@storefront-types';

/**
 * The single money formatter for every storefront surface.
 *
 * There is one implementation, not one per component: before it existed there
 * were seven copies and every one of them pinned two fraction digits, which is
 * wrong for any three-decimal currency.
 *
 * Since plan E2.4 the format is not a constant of this file. Everything that
 * shapes a rendered price comes from the `money` group of the runtime config
 * (DR-31): the currency code, the symbol, which side of the number it sits on,
 * the decimal and thousands separators, and how many fraction digits to show.
 * A caller passes that group in; no component states a currency or a precision
 * of its own.
 *
 * The grouping is applied here rather than through `Intl`, which is a change
 * from the previous generation of this file. `Intl` picks separators from the
 * locale, so the same store rendered `1 990,000` under one locale and
 * `1,990.000` under another, and an Arabic locale would additionally have
 * switched to Arabic-Indic digits. The operator configures one money format
 * for the store, so the format is the store's, not the reader's, and the
 * digits are always western.
 *
 * A row carrying its own historical currency (an order placed before a
 * currency change) renders at that currency's ISO precision with its ISO code
 * rather than the store symbol, which is the one case where the configured
 * format does not apply.
 */

/** The subset of the runtime `money` group a rendered amount needs. */
export type MoneyFormat = Pick<
  StorefrontRuntimeConfig['money'],
  | 'currencyCode'
  | 'symbol'
  | 'symbolPosition'
  | 'decimalSeparator'
  | 'thousandsSeparator'
  | 'displayPrecision'
>;

/** No-break space, between the amount and the symbol. */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

/**
 * The ISO 4217 minor-unit count, straight from `Intl` rather than a table we
 * would have to keep in step with one. `Intl` throws on a malformed code and
 * answers 2 for a well-formed but unassigned one; only the throw falls back.
 */
function isoDigits(code: string): number | undefined {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
      .maximumFractionDigits;
  } catch {
    return undefined;
  }
}

/** True when the row carries a currency other than the one the store trades in. */
function isForeign(money: MoneyFormat, currency: string | null | undefined): boolean {
  return Boolean(currency) && currency !== money.currencyCode;
}

/**
 * How many fraction digits an amount renders with: the configured display
 * precision for the store currency, the ISO minor-unit count for any other.
 */
export function moneyFractionDigits(money: MoneyFormat, currency?: string | null): number {
  if (!isForeign(money, currency)) return money.displayPrecision;
  return isoDigits(currency as string) ?? money.displayPrecision;
}

/**
 * Fixed-point digits, grouped in threes, with the configured separators.
 *
 * The digits come from `Intl` under a fixed `en-US`, not from `toFixed`, and
 * the separators are applied afterwards. `toFixed` rounds the binary double,
 * so `1.2345` at three digits gives `1.234` because the stored value is
 * slightly below the half; `Intl` rounds the decimal value and gives `1.235`,
 * which is what a shopper checking the arithmetic expects. Pinning the locale
 * to `en-US` keeps the digits western and the decimal a dot, so the only
 * locale-shaped thing left is the rounding rule.
 */
const DIGITS_ONLY_LOCALE = 'en-US';

function groupDigits(amount: number, digits: number, money: MoneyFormat): string {
  const fixed = new Intl.NumberFormat(DIGITS_ONLY_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(Math.abs(amount));
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, money.thousandsSeparator);
  const sign = amount < 0 ? '-' : '';
  return fraction ? `${sign}${grouped}${money.decimalSeparator}${fraction}` : `${sign}${grouped}`;
}

/**
 * Render an amount in the store's configured format.
 *
 * @param currency the row's own currency, when it carries one. Equal to the
 *   store currency or absent means the configured symbol and precision apply.
 */
export function formatMoney(value: number, money: MoneyFormat, currency?: string | null): string {
  const digits = moneyFractionDigits(money, currency);
  // A totals row asserted only for non-empty length passes on the string "NaN".
  const amount = Number.isFinite(value) ? value : 0;
  const rendered = groupDigits(amount, digits, money);
  const unit = isForeign(money, currency) ? (currency as string) : money.symbol;

  return money.symbolPosition === 'before'
    ? `${unit}${NO_BREAK_SPACE}${rendered}`
    : `${rendered}${NO_BREAK_SPACE}${unit}`;
}
