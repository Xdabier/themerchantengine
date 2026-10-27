import { Prisma } from '@prisma/client';
import { NEUTRAL_LOCALE_SET } from '../locale/store-locales';

/**
 * Money precision and rounding for the whole engine.
 *
 * Storage precision is three decimals for every currency (`Decimal(12, 3)`), so a three-decimal currency keeps its smallest unit.
 * Before D4 the money columns were `numeric(10,2)` and every computation was an
 * unrounded IEEE-754 expression, which was invisible only because the seeded
 * tax rate was 0.0 and so `taxAmount` was always exactly zero. Seeding 19 per
 * cent activates that path, and 19 per cent of a millime-precision base lands
 * on a half-millime tie on every price ending in a 50-millime step.
 *
 * Three engines would otherwise each round the same value by their own rule:
 * Postgres `numeric` on write, JavaScript float in the composition, and `Intl`
 * on display. This module is the single rounding authority, so a total is the
 * sum of the components the customer can see, rather than a number that happens
 * to be within half a millime of it.
 *
 * `Decimal` is used for the arithmetic rather than `number` because
 * `0.1 + 0.2 !== 0.3` is exactly the class of error a three-decimal currency
 * makes visible. Values still cross the wire as numbers, per `plan.md` §2.8:
 * every amount representable in `Decimal(12, 3)` is at most 999,999,999,999
 * millimes, inside the range where a double holds an integer exactly, so a
 * quantised amount survives the round trip.
 */

/** Fraction digits for the store currency. Matches `@db.Decimal(12, 3)`. */
export const MONEY_DECIMAL_PLACES = 3;

/**
 * Round half away from zero, which is what Postgres `numeric` does on write.
 * Choosing the same rule here is what makes the stored value and the computed
 * one agree instead of differing by a millime on every tie.
 */
export function roundMoney(value: Prisma.Decimal.Value): number {
  return new Prisma.Decimal(value)
    .toDecimalPlaces(MONEY_DECIMAL_PLACES, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** Sum a list of amounts, rounding once at the end rather than per term. */
export function sumMoney(values: readonly Prisma.Decimal.Value[]): number {
  return roundMoney(
    values.reduce<Prisma.Decimal>(
      (acc, v) => acc.plus(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    ),
  );
}

/** A line total: unit price times quantity, quantised once. */
export function lineTotal(unitPrice: Prisma.Decimal.Value, quantity: number): number {
  return roundMoney(new Prisma.Decimal(unitPrice).times(quantity));
}

/** An amount times a rate (tax, percentage discount), quantised once. */
export function applyRate(amount: Prisma.Decimal.Value, rate: Prisma.Decimal.Value): number {
  return roundMoney(new Prisma.Decimal(amount).times(new Prisma.Decimal(rate)));
}

function isoDigits(code: string): number | undefined {
  try {
    return new Intl.NumberFormat(NEUTRAL_LOCALE_SET.defaultLocale, {
      style: 'currency',
      currency: code,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    return undefined;
  }
}

/**
 * The ISO 4217 minor-unit count for a currency, straight from `Intl` rather
 * than a table that would have to be kept in step with one. A missing or
 * malformed code gets the storage precision, never a store literal: the
 * store currency is runtime config (`storeMoney`, DR-31), and the callers
 * that have no row currency read it from there.
 */
export function currencyDecimalPlaces(currency: string | null | undefined): number {
  return (currency ? isoDigits(currency) : undefined) ?? MONEY_DECIMAL_PLACES;
}

/**
 * An amount as a plain fixed-point string at its currency's own precision.
 *
 * For the surfaces that emit a bare number beside a separate currency token:
 * the Google Merchant feed, JSON-LD offers, llms.txt. Every one of them used a
 * hardcoded `toFixed(2)`, so a correctly stored 12.345 in a three-decimal
 * currency was printed as 12.35, the stored value and the shown value
 * disagreeing with nothing raising.
 *
 * Not a display formatter: no grouping, no symbol, no locale. Machine-readable
 * surfaces need exactly this shape; `formatMoney` in `./store-money.ts` is the
 * human-facing one and reads the runtime config.
 */
export function formatAmount(
  value: Prisma.Decimal.Value | null | undefined,
  currency: string,
): string {
  // Takes `Prisma.Decimal.Value` like the three functions above, because a money
  // column reads back as a Decimal and the narrower `number | string` signature
  // sent one down the non-string branch, where `Number.isFinite(<object>)` is
  // false and the never-NaN guard below turned a real price into a zero.
  const num = Number(value ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  return safe.toFixed(currencyDecimalPlaces(currency));
}
