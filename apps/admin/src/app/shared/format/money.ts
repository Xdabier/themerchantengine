import { adminIntlTag } from './intl-tag';

/**
 * The single money formatter for every admin display surface.
 *
 * Canonical format is the ISO code before the amount — `XTS 1,240.000`.
 *
 * **This is deliberately NOT the storefront format**, which is `1 240,000 DT`
 * per the client's brand floor §3.2. The two differ because the admin is
 * Badii Studio's own operator product under constitution §3.9 rather than a
 * client surface, because an operator reading a list of orders that each carry
 * their own historical currency needs an unambiguous code rather than a
 * symbol, and because `ر.ق` inside a Latin-script LTR admin would be the only
 * right-to-left run on the screen. The symbol stays in settings for the
 * storefront; the admin does not render it.
 *
 * The locale is pinned to the registry English tag on purpose, so output is identical across
 * operator browsers and in CI. Money output therefore does NOT vary with the
 * profile locale (unlike Translatable text), and digits are always western.
 *
 * Fraction digits come from `decimalPlaces` on the store currency config, so a
 * three-decimal currency renders its millime without this file knowing which
 * currency is in play. That is why the D4 rebrand needed no change here beyond
 * this comment.
 *
 * There is deliberately **no currency default**. A caller that does not know
 * the currency passes `null` and gets a bare amount (`100.000`) — never a
 * fabricated `USD`. Removing the default is what forces the compiler to flag
 * every call site.
 */

/** The store currency config, or a bare ISO code when only that is known. */
export type MoneyCurrency = string | { code: string; decimalPlaces?: number } | null | undefined;

const NBSP = /[  ]/g;

/**
 * `decimalPlaces` arrives from a stored setting, so it is not guaranteed sane.
 * Intl and `toFixed` both throw outside their ranges, and a throw here would
 * take down every money cell on the screen. Clamp to the ISO range instead.
 */
function safeDigits(digits: number | undefined): number | undefined {
  if (typeof digits !== 'number' || !Number.isInteger(digits)) return undefined;
  return Math.min(Math.max(digits, 0), 4);
}

function resolve(currency: MoneyCurrency): { code: string; decimalPlaces?: number } | null {
  if (!currency) return null;
  if (typeof currency === 'string') return currency ? { code: currency } : null;
  if (!currency.code) return null;
  return { code: currency.code, decimalPlaces: safeDigits(currency.decimalPlaces) };
}

export function formatMoney(
  value: number | string | null | undefined,
  currency: MoneyCurrency,
  fallback = '—',
): string {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return fallback;

  const resolved = resolve(currency);
  const digits = resolved?.decimalPlaces;

  // Unhydrated / currency-less: a bare grouped amount, no invented code.
  if (!resolved) {
    return new Intl.NumberFormat(adminIntlTag(), {
      minimumFractionDigits: digits ?? 2,
      maximumFractionDigits: digits ?? 2,
    }).format(num);
  }

  try {
    return new Intl.NumberFormat(adminIntlTag(), {
      style: 'currency',
      currency: resolved.code,
      currencyDisplay: 'code',
      ...(digits === undefined
        ? {}
        : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    })
      .format(num)
      .replace(NBSP, ' ');
  } catch {
    return `${num.toFixed(digits ?? 2)} ${resolved.code}`;
  }
}
