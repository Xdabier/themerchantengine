import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Recurrence guard: every price the storefront renders carries a tax mention.
 *
 * agent_docs/storefront/brand-tokens.md says every displayed price carries `TTC` or `HT` "without
 * exception", and §10 row 12 fails a price without one. `PriceComponent` grew
 * a `taxMention` input for exactly that, and then D4 shipped the input bound at
 * ZERO call sites, so every catalogue, cart, wishlist and order price rendered
 * bare while the component's unit spec passed on a prop it was handed directly.
 *
 * A per-component spec cannot catch that: it tests the primitive in isolation,
 * and the defect is in the parents. This scans the source instead, so a new
 * price surface added later fails here rather than in a brand audit months on.
 *
 * There are two ways a price reaches the screen and the first version of this
 * guard only knew about one of them, which is why the order-confirmation page
 * rendered four unlabelled amounts through the gate:
 *
 *  - via `<app-price>`, which must bind `taxMention`;
 *  - via a direct `formatMoney` call interpolated in the template, which the
 *    `<app-price>` scan is completely blind to.
 *
 * The direct-render check is per FILE, not per interpolation: a totals table
 * states its tax posture on the rows that carry it, and demanding a mention
 * beside every intermediate figure would be wrong on the screen. What the
 * check actually prevents is a whole money surface shipping with no mention
 * anywhere, which is the defect that occurred.
 */

const SRC = join(__dirname, '..', '..');

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * Each `<app-price ...>` element in a template, opening tag only. Templates are
 * inline in this codebase, so a source scan reaches every one of them.
 *
 * Built fresh per use. The previous version was a single module-level `/g`
 * regex shared between `.test()` in a filter and `.match()` in the assertion:
 * `.test()` on a `/g` regex advances `lastIndex` and resumes from it on the
 * next call, so the discovery filter silently skipped every other matching
 * file and the offender list was built from half the surfaces.
 */
const priceTag = (): RegExp => /<app-price\b[^>]*>/g;

/**
 * A money amount interpolated in a template.
 *
 * Two signals, because neither alone is right. The first version matched only
 * `{{ formatted(` / `{{ formatMoney(`, requiring the paren immediately after
 * the name, so `{{ formattedLineTotal() }}` did not match and
 * `cart-line.component.ts` never entered `directRenderFiles` at all: the cart
 * line total, one of the two amounts this guard was widened to cover, sat
 * outside the check written to cover it.
 *
 * Loosening to any `format*(` call swings too far the other way and catches
 * `formatAddress`, `formatDate` and the review-score helpers, none of which
 * render money. So a file qualifies only when it BOTH imports the money
 * formatter and interpolates a `format*` call in its template.
 */
const IMPORTS_MONEY = /\bformatMoney\b[^;]*from\s+['"][^'"]*\/money['"]/;
const moneyRender = /\{\{[^}]*\bformat[A-Za-z]*\s*\(/;

/** Either mention, however it is reached: the input, or the i18n strings. */
const hasMention = /taxMention|taxExcluded|taxIncluded/;

/**
 * Surfaces that render a money amount which is not a price.
 *
 * A coupon and a gift card each render the amount they take OFF a price. A
 * deduction has no tax posture of its own, and both are rendered inside the
 * cart page directly above `cart-totals`, which states the posture for the
 * figures they adjust. Listed by name rather than pattern-matched so that
 * adding a surface here is a deliberate act with a reason attached.
 */
const NOT_A_PRICE = [
  'coupon-form.component.ts',
  'gift-card-form.component.ts',
  // Decided at plan E2.5 (B2.9), which is where gate A left the question. The
  // shell repeats the delivery method and its rate as a reminder of a choice
  // the shopper has already made; the authoritative figures with their mention
  // are in the summary beneath it. The one figure in the shell that IS a quote,
  // the collapsed step-2 total, is composed in `step-summary.ts` and carries
  // the mention its own spec pins under all three `money.taxDisplay` values.
  // Paired with the same entry in the journey's NOT_A_PRICE_HOSTS.
  'checkout-step-shell.component.ts',
  // The price-band filter labels are facts about the catalogue's range, not
  // figures the store is charging, so they owe no mention (plan E2.5, B2.9).
  // Listed even though the scan below would miss the file anyway: it formats
  // its bounds in a TS computed rather than in a template interpolation, so
  // `moneyRender` never matches it. An unguarded file and a decided one look
  // the same from here unless the decision is written down.
  'filter-rail.component.ts',
];

describe('every rendered price carries a tax mention', () => {
  const all = collect(SRC);
  const priceTagFiles = all.filter((f) => priceTag().test(readFileSync(f, 'utf8')));
  const directRenderFiles = all.filter((f) => {
    if (f.endsWith('price.component.ts')) return false;
    if (NOT_A_PRICE.some((n) => f.endsWith(n))) return false;
    const src = readFileSync(f, 'utf8');
    return IMPORTS_MONEY.test(src) && moneyRender.test(src);
  });

  it('finds the price surfaces to scan', () => {
    // If either drops to zero the guard has stopped guarding anything.
    expect(priceTagFiles.length).toBeGreaterThan(4);
    expect(directRenderFiles.length).toBeGreaterThan(2);
    // The cart line total was outside this set until the regex was widened.
    expect(directRenderFiles.some((f) => f.endsWith('cart-line.component.ts'))).toBe(true);
  });

  it('binds taxMention on every <app-price>', () => {
    const offenders: string[] = [];
    for (const file of priceTagFiles) {
      // The component's own definition declares the input; it is not a caller.
      if (file.endsWith('price.component.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const tag of src.match(priceTag()) ?? []) {
        if (!/taxMention/.test(tag)) {
          offenders.push(`${relative(SRC, file)} → ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    // If this fails: pass taxMention="excluded" for an HT price (catalogue,
    // cart, product, line items) or taxMention="included" for a charged total.
    expect(offenders).toEqual([]);
  });

  it('carries a mention on every surface that formats money directly', () => {
    const offenders = directRenderFiles
      .filter((f) => !hasMention.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    // If this fails: render `strings().generic.taxExcluded` beside the HT
    // figure, or `strings().generic.taxIncluded` beside the charged total. If
    // the amount is a deduction rather than a price, add the file to
    // NOT_A_PRICE above with the reason.
    expect(offenders).toEqual([]);
  });
});
