import type { Cart } from '@storefront-types';

import type { ChromeStrings } from '../../../i18n/types';
import { formatMoney, type MoneyFormat } from '../../../lib/money';

/** What the store shows beside a price: tax-exclusive, tax-inclusive, or nothing. */
type TaxDisplay = 'HT' | 'TTC' | 'none';

/**
 * The line a collapsed checkout step 2 shows in place of the summary itself
 * (finding K3).
 *
 * It used to read the item count alone, so a shopper who folded the summary
 * away had no figure in front of them on the very step where they commit to
 * paying it. Count and total, together.
 *
 * The mention follows the same rule `price.component.ts` applies (plan E2.5): a
 * store that displays no tax mention gets none here either, and otherwise the
 * label says what the figure actually is. The recap quotes the tax-inclusive
 * total when the API has resolved one and the ex-tax total when it has not, so
 * labelling it unconditionally `TTC` was wrong twice over.
 *
 * A free function rather than a method so it can be tested against a cart
 * literal. `step2Summary` on the page is a `computed()` class field, which is
 * unreachable from the prototype, and driving a whole checkout to read one
 * string tests the fixtures instead of the string.
 */
export function buildStepSummary(
  cart: Cart | null | undefined,
  strings: ChromeStrings,
  money: MoneyFormat,
  /** `money.taxDisplay` from the runtime config, which `MoneyFormat` omits. */
  taxDisplay: TaxDisplay,
): string | null {
  if (!cart) return null;

  const count = cart.items?.length ?? 0;
  const steps = strings.checkout.steps;
  const countText =
    count === 1 ? steps.itemsCountOne : steps.itemsCount.replace('{count}', String(count));

  const total = totalOf(cart);
  if (total == null) return countText;

  const formattedTotal = formatMoney(total.value, money, cart.currency);
  const recap = steps.summary.recap
    .replace('{count}', countText)
    .replace('{total}', formattedTotal);
  const mention = taxMention(total.taxInclusive, taxDisplay, strings);
  // The separator travels with the mention: a store that shows none must not
  // ship the space and comma the template put in front of it.
  return mention ? recap.replace('{taxMention}', mention) : stripTaxMention(recap);
}

/** `price.component.ts`'s rule, applied to a figure this file knows the shape of. */
function taxMention(
  inclusive: boolean,
  display: TaxDisplay,
  strings: ChromeStrings,
): string | null {
  if (display === 'none') return null;
  return inclusive || display === 'TTC' ? strings.generic.taxIncluded : strings.generic.taxExcluded;
}

/**
 * Remove the `{taxMention}` placeholder and whatever punctuation the copy put
 * before it, so a store with no mention reads as a clean sentence rather than a
 * total followed by a dangling comma.
 */
function stripTaxMention(recap: string): string {
  return recap.replace(/[\s,·-]*\{taxMention\}/, '').trim();
}

/**
 * The same ladder the order summary walks, so the collapsed recap and the open
 * one can never quote different numbers. `grandTotalTtc` is the API's
 * tax-inclusive figure and is absent until a tax zone has resolved;
 * `grandTotal` excludes VAT and is the last resort rather than the default.
 */
function totalOf(cart: Cart): { value: number; taxInclusive: boolean } | null {
  const ttc = (cart as { grandTotalTtc?: unknown }).grandTotalTtc;
  const raw =
    ttc ?? (cart as { grandTotal?: unknown }).grandTotal ?? (cart as { total?: unknown }).total;
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return { value: n, taxInclusive: ttc != null };
}
