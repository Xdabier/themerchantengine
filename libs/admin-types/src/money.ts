import * as z from 'zod';

/**
 * Money precision for the admin, mirroring the backend's `@common/money`.
 *
 * The store currency is XTS, a three-decimal currency. Before D4 the admin did
 * not merely *display* two decimals, it *rejected* a third one in three
 * independent places, so an operator could not enter a legitimate millime
 * price and the failure surfaced as a client-side validation error rather than
 * a formatting oddity.
 *
 * A Zod schema is evaluated at module load, so it cannot read the store's
 * `decimalPlaces` the way a component can. It takes this constant instead, and
 * the two runtime gates that *can* reach `CurrencyStore` — the Reactive Forms
 * validator and the `step` attribute — are parameterised by scale and fed from
 * `CurrencyStore.config().decimalPlaces`. That is the honest split: one named
 * constant where the architecture is static, the live setting where it is not.
 */
export const MONEY_DECIMAL_PLACES = 3;

/** `10 ** scale`, the multiplier a scale check compares against. */
export function moneyScaleFactor(decimalPlaces: number): number {
  return 10 ** decimalPlaces;
}

/**
 * True when `value` carries no more than `decimalPlaces` fraction digits.
 *
 * Uses `Number.EPSILON`-free integer comparison on the scaled value, matching
 * the shape the previous two-decimal refine used, so the only thing that
 * changed is the scale rather than the arithmetic.
 */
export function hasMoneyScale(value: number, decimalPlaces = MONEY_DECIMAL_PLACES): boolean {
  const factor = moneyScaleFactor(decimalPlaces);
  return Math.round(value * factor) === value * factor;
}

/** The shared money schema every admin price field parses against. */
export const moneySchema = z
  .number()
  .nonnegative()
  .refine((n) => hasMoneyScale(n), {
    message: `At most ${MONEY_DECIMAL_PLACES} decimal places`,
  });
