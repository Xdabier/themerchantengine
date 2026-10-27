import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { LocaleService } from '../locale.service';
import { formatMoney } from '../../lib/money';
import { StoreConfigService } from '../services/store-config.service';
import { DEFAULT_LOCALE, type Locale } from '../../i18n/types';
import { getChromeStrings } from '../../i18n';

/**
 * Every price the storefront renders, in the charte's format.
 *
 * Formatting itself lives in `lib/money.ts`, which is the single formatter for
 * the whole app. This component owns the *presentation* around the number: the
 * compare-at strike-through, the discount badge, and the tax mention that
 * agent_docs/storefront/brand-tokens.md requires on every displayed price without exception.
 *
 * `taxMention` is required at every call site, and a source-scanning guard
 * (`price-tax-mention.guard.spec.ts`) enforces that. A silent default is what
 * let the input ship bound at zero call sites, so every catalogue, cart and
 * order price rendered bare while this component's own unit spec passed on a
 * prop it was handed directly.
 *
 * `'excluded'` for an HT price (catalogue, cart, product, order line items),
 * `'included'` for an amount actually charged (the checkout and order totals),
 * per `plan.md` §2.2. `'none'` exists for the rows of a totals BREAKDOWN —
 * shipping, VAT, discount — where the figure is a component of a total that is
 * itself labelled, and where a mention on the VAT line would be nonsense. It
 * has to be stated rather than omitted, so the guard can tell a considered
 * opt-out from a forgotten one.
 */
export type PriceTaxMention = 'excluded' | 'included' | 'none';

@Component({
  selector: 'app-price',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (compareAt() != null && compareAt()! > amount()) {
      <span class="compare-at">
        <span>{{ formatted(compareAt()!) }}</span>
      </span>
    }
    <span class="amount" [class.discounted]="hasDiscount()">{{ formatted(amount()) }}</span>
    @if (resolvedTaxLabel(); as label) {
      <span class="tax-mention">{{ label }}</span>
    }
    @if (hasDiscount()) {
      <span class="discount-badge">-{{ discountPercent() }}%</span>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.25rem 0.5rem;
        font-size: var(--brand-text-price);
        font-weight: 600;
        color: var(--brand-text);
        min-inline-size: 0;
        /* agent_docs/storefront/brand-tokens.md — mandatory wherever numbers stack. */
        font-variant-numeric: tabular-nums;
      }
      .compare-at {
        font-size: var(--brand-text-micro);
        font-weight: 400;
        color: var(--brand-text-muted);
        text-decoration: line-through;
      }
      .amount.discounted {
        color: var(--brand-primary-dark);
      }
      .tax-mention {
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text-muted);
      }
      .discount-badge {
        font-size: var(--brand-text-micro);
        font-weight: 600;
        /* Grounded on the primary family, not the accent: agent_docs/storefront/brand-tokens.md
           forbids a promotional badge that uses a STATE colour, and the accent
           has no counterpart in the generated palette. The pressed step rather than the base
           one, because this label is micro-sized and §2.5 fails white under
           16 px on the base tone. */
        background-color: var(--brand-primary-dark);
        color: var(--brand-on-primary);
        padding-block: 0.125rem;
        padding-inline: 0.375rem;
        border-radius: var(--brand-radius-sm);
      }
    `,
  ],
})
export class PriceComponent {
  readonly amount = input.required<number>();
  readonly compareAt = input<number | null>(null);
  readonly currency = input<string>('');
  /**
   * Required, not optional-with-a-null-default. The input shipped optional and
   * bound at zero call sites, so every price in the storefront rendered bare
   * while this component's own spec passed on a prop it was handed directly.
   * Making it required moves that from a source-scanning guard to a template
   * type error the production build catches.
   */
  readonly taxMention = input.required<PriceTaxMention>();
  readonly localeOverride = input<Locale | null>(null);

  private readonly localeService = inject(LocaleService, { optional: true });
  private readonly storeConfig = inject(StoreConfigService);
  /**
   * Explicit input first, then the configured store currency, then the baked
   * constant. Orders and gift cards carry their own code and must keep it; a
   * caller that passes nothing gets whatever the operator configured, which is
   * the whole point of finding D5.
   */
  protected readonly resolvedCurrency = computed(
    () => this.currency() || this.storeConfig.currencyCode(),
  );

  protected readonly hasDiscount = computed(() => {
    const ca = this.compareAt();
    return ca != null && ca > this.amount();
  });

  protected readonly discountPercent = computed(() => {
    const ca = this.compareAt();
    if (!ca || ca <= this.amount()) return 0;
    return Math.round(((ca - this.amount()) / ca) * 100);
  });

  protected readonly resolvedLocale = computed<Locale>(
    () => this.localeOverride() ?? this.localeService?.locale() ?? DEFAULT_LOCALE,
  );

  /**
   * The mention this price renders, or null for none.
   *
   * The call site says what kind of price this is: a catalogue price quoted
   * before tax (`excluded`), a total actually charged (`included`), or a
   * breakdown row that carries no mention of its own (`none`). What that turns
   * into on screen is the store's decision, from `money.taxDisplay`:
   *
   *   - a store that displays no tax mention renders none anywhere;
   *   - a store whose catalogue is tax-inclusive labels its catalogue prices
   *     as such, because quoting them as pre-tax would be wrong;
   *   - a charged total always reads tax-inclusive, whatever the catalogue
   *     quotes, because that is the figure the customer pays.
   *
   * Before plan E2.4 the call site's word went straight to the screen, so a
   * tax-inclusive store still labelled its catalogue `HT`.
   */
  protected readonly resolvedTaxLabel = computed<string | null>(() => {
    const mention = this.taxMention();
    if (mention === 'none') return null;
    const display = this.storeConfig.money().taxDisplay;
    if (display === 'none') return null;
    const generic = getChromeStrings(this.resolvedLocale()).generic;
    if (mention === 'included' || display === 'TTC') return generic.taxIncluded;
    return generic.taxExcluded;
  });

  protected formatted(value: number): string {
    return formatMoney(value, this.storeConfig.money(), this.resolvedCurrency());
  }
}
