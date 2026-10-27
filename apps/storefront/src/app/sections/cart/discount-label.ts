import { pickTranslation, type ResolvedString } from '@storefront-types';

/**
 * Resolve one `discounts[].label` for display.
 *
 * The API types the field `unknown` because it carries whatever the promotion
 * was named: a raw Translatable JSON object on the automatic lines, and a
 * plain coupon-code string on the synthesised coupon line. Interpolating the
 * object form straight into a template prints `[object Object]`, which is the
 * whole reason the totals block merged every promotion into one anonymous row
 * instead of naming them.
 *
 * `fallback` covers a label that resolves to nothing at all, so a row always
 * carries a word rather than an empty cell.
 */
export function resolveDiscountLabel(label: unknown, locale: string, fallback: string): string {
  if (typeof label === 'string') return label.trim() || fallback;
  if (label && typeof label === 'object') {
    return pickTranslation(label as ResolvedString, locale).trim() || fallback;
  }
  return fallback;
}
