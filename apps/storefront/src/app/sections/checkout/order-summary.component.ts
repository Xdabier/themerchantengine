import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { Cart, CartLine, ShippingMethodQuote } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { DEFAULT_LOCALE, type Locale } from '../../../i18n/types';
import { formatMoney } from '../../../lib/money';
import { StoreConfigService } from '../../services/store-config.service';
import { resolveDiscountLabel } from '../cart/discount-label';

/**
 * Pure-presentational order summary surfaced inside checkout step 2 + the
 * order-confirmation page. Reads the cart snapshot from the parent and
 * formats every monetary value via Intl.NumberFormat with the locale's
 * BCP-47 currency tag.
 */
@Component({
  selector: 'app-order-summary',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="summary"
      [attr.aria-label]="strings().checkout.steps.summary.title"
      data-testid="order-summary"
    >
      <ul class="lines" [attr.aria-label]="strings().checkout.steps.summary.items">
        @for (line of items(); track line.id) {
          <li class="line">
            <span class="qty"
              ><span>{{ line.quantity }}×</span></span
            >
            <span class="name">{{ resolveName(line.productName) }}</span>
            <span class="amount"
              ><span>{{ formatted(lineTotal(line)) }}</span></span
            >
          </li>
        }
      </ul>
      <dl class="rows" aria-live="polite" aria-atomic="true">
        <div class="row">
          <dt>{{ strings().checkout.steps.summary.subtotal }}</dt>
          <dd>
            <span>{{ formatted(subtotalNumber()) }}</span>
          </dd>
        </div>
        @for (line of discountLines(); track line.key) {
          <div
            class="row discount"
            data-testid="order-summary-discount"
            [attr.data-type]="line.type"
          >
            <dt>{{ line.label }}</dt>
            <dd>
              <span>-{{ formatted(line.amount) }}</span>
            </dd>
          </div>
        }
        <div class="row">
          <dt>{{ strings().checkout.steps.summary.shipping }}</dt>
          <dd>
            @if (shippingNumber() == null) {
              <span>{{ strings().cart.page.shippingEstimate }}</span>
            } @else if (shippingNumber()! > 0) {
              <span>{{ formatted(shippingNumber()!) }}</span>
            } @else {
              <span>{{ strings().checkout.steps.summary.shippingFree }}</span>
            }
          </dd>
        </div>
        @if (taxNumber() != null && taxNumber()! > 0) {
          <div class="row" data-testid="order-summary-tax">
            <dt>{{ strings().checkout.steps.summary.tax }}</dt>
            <dd>
              <span>{{ formatted(taxNumber()!) }}</span>
            </dd>
          </div>
        }
        <div class="row total">
          <dt>{{ strings().checkout.steps.summary.total }}</dt>
          <dd>
            <span data-testid="order-summary-total">{{ formatted(totalNumber()) }}</span>
            @if (taxMention(); as mention) {
              <span class="tax-mention" data-testid="order-summary-tax-mention">{{ mention }}</span>
            }
          </dd>
        </div>

        @if (giftCardApplied(); as applied) {
          <div class="row discount" data-testid="order-summary-gift-card">
            <dt>{{ strings().cart.page.giftCardRow }} ({{ applied.code }})</dt>
            <dd>
              <span>-{{ formatted(applied.amount) }}</span>
            </dd>
          </div>
          <div class="row total" data-testid="order-summary-payable">
            <dt>{{ strings().cart.page.amountPayable }}</dt>
            <dd>
              <span>{{ formatted(payableNumber()) }}</span>
            </dd>
          </div>
        }
      </dl>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .summary {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .lines {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .line {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 0.75rem;
        font-size: var(--brand-text-body);
        color: var(--brand-text);
      }
      .qty {
        color: var(--brand-text-muted);
      }
      .name {
        color: var(--brand-text);
      }
      /* agent_docs/storefront/brand-tokens.md: mandatory wherever numbers stack, which a line-item
         list and a totals column both are. It appeared zero times in the
         storefront before D4. */
      .amount,
      .qty,
      .row dd {
        font-variant-numeric: tabular-nums;
      }
      .amount {
        font-weight: 600;
      }
      .tax-mention {
        margin-inline-start: 0.375rem;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text-muted);
      }
      .rows {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-block-start: 0.75rem;
        border-block-start: 1px solid var(--brand-border);
      }
      .row {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        font-size: var(--brand-text-body);
        color: var(--brand-text);
      }
      .row dt,
      .row dd {
        margin: 0;
      }
      /* Audit row 7: the success colour means in stock, shipped, or paid.
         A discount is a promotion, not a state, so the amount carries no
         state colour. Weight alone distinguishes it. */
      .row.discount dd {
        color: var(--brand-text);
        font-weight: 600;
      }
      .row.total {
        padding-block-start: 0.5rem;
        border-block-start: 1px solid var(--brand-border);
        font-weight: 600;
        font-size: var(--brand-text-product);
      }
    `,
  ],
})
export class OrderSummaryComponent {
  readonly cart = input.required<Cart>();
  readonly currency = input<string>('');
  /**
   * The shipping method the customer picked at checkout, when there is one.
   *
   * `Cart.shippingEstimate` caches the ZONE DEFAULT rate (`cart.service.ts`
   * `estimateShipping`), so on a store with a second active method the summary
   * quoted a price the order would not charge. Passing the selection in keeps
   * the row honest without moving the cart's own field, which the cart page
   * still reads.
   */
  readonly selectedShippingRate = input<ShippingMethodQuote | null>(null);

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

  private readonly localeService = inject(LocaleService);
  protected readonly strings = this.localeService.strings;

  protected readonly items = computed(() => this.cart().items ?? []);
  protected readonly subtotalNumber = computed(() => Number(this.cart().subtotal ?? 0));
  /**
   * One row per promotion, matching the cart totals contract exactly.
   *
   * A customer reviewing the order before paying could not tell which
   * discount took what: every promotion collapsed into one anonymous row, so
   * the summary and the coupon chip disagreed with no way to reconcile them.
   * Zero-amount entries are the FREE_SHIPPING signal and belong on the
   * shipping row, not here.
   */
  protected readonly discountLines = computed(() => {
    const locale = this.localeService?.locale() ?? DEFAULT_LOCALE;
    const cart = this.cart();
    const lines = (cart.discounts ?? [])
      .map((d, index) => ({
        key: d.promotionId || `${d.type}-${index}`,
        type: d.type,
        label: resolveDiscountLabel(
          d.label,
          locale,
          this.strings().checkout.steps.summary.discount,
        ),
        amount: Number(d.amount ?? 0),
      }))
      .filter((d) => d.amount > 0);
    if (lines.length) return lines;
    const explicit = Number(cart.discountAmount ?? 0);
    return explicit > 0
      ? [
          {
            key: 'discount-total',
            type: 'automatic' as const,
            label: this.strings().checkout.steps.summary.discount,
            amount: explicit,
          },
        ]
      : [];
  });
  // The names the API actually emits. These read `shippingAmount` and
  // `taxAmount`, which `CartResponse` has never carried, so the VAT row on the
  // checkout summary has never rendered.
  protected readonly shippingNumber = computed(() => {
    const v = this.cart().shippingEstimate;
    const quoted = v == null ? null : Number(v);
    const picked = this.selectedShippingRate();
    // A zero cached estimate is a free-shipping promotion the server already
    // applied, not an absent quote. Overriding it with the picked method's
    // price would re-charge shipping the promotion removed.
    if (!picked || quoted === 0) return quoted;
    return Number(picked.price ?? 0);
  });

  /**
   * What the picked method adds to, or saves against, the cached default the
   * API composed `grandTotalTtc` from.
   */
  private readonly shippingDelta = computed(() => {
    const picked = this.selectedShippingRate();
    const quoted = this.cart().shippingEstimate;
    if (!picked || quoted == null || Number(quoted) === 0) return 0;
    return Number(picked.price ?? 0) - Number(quoted);
  });
  protected readonly taxNumber = computed(() => {
    const v = this.cart().taxEstimate;
    return v == null ? null : Number(v);
  });
  /**
   * Checkout shows the TAX-INCLUSIVE total, per `plan.md` §2.2: the catalogue
   * and cart quote HT and the TTC total appears here.
   *
   * `grandTotal` is goods less discount plus shipping and excludes VAT
   * entirely, so binding the headline row to it under a 19 per cent rate
   * under-quoted the charge by the whole tax. `grandTotalTtc` is the API's
   * composed figure; the fallbacks keep the row rendering before a delivery
   * country has resolved a tax zone, at which point HT and TTC are equal.
   */
  protected readonly totalNumber = computed(
    () =>
      Number(this.cart().grandTotalTtc ?? this.cart().grandTotal ?? this.cart().total ?? 0) +
      this.shippingDelta(),
  );

  /**
   * `HT` until a tax zone has resolved, `TTC` once VAT is in the total.
   *
   * Both mentions exist because the two states are genuinely different
   * amounts, and agent_docs/storefront/brand-tokens.md fails a price carrying neither. Labelling
   * the pre-address total `TTC` would be the untruthful half of the pair.
   */
  /**
   * The gift card, carried through to the last surface before payment.
   *
   * Checkout showed nothing at all, so a card applied on the cart meant the
   * shopper confirmed one number and was charged another. `balanceApplied` is
   * capped server-side against the same TTC base order creation uses, so the
   * figure here is the figure deducted.
   */
  protected readonly giftCardApplied = computed(() => {
    const card = this.cart().giftCard;
    if (!card) return null;
    const amount = Number(card.balanceApplied ?? 0);
    return amount > 0 ? { code: card.code, amount } : null;
  });

  protected readonly payableNumber = computed(() =>
    Math.max(0, this.totalNumber() - (this.giftCardApplied()?.amount ?? 0)),
  );

  /**
   * The mention beside the checkout total, or null for a store that displays
   * none. Whether tax has been added decides which of the two it is; whether
   * the store shows one at all is `money.taxDisplay`.
   */
  protected readonly taxMention = computed<string | null>(() => {
    if (this.storeConfig.money().taxDisplay === 'none') return null;
    const generic = this.strings().generic;
    return (this.taxNumber() ?? 0) > 0 ? generic.taxIncluded : generic.taxExcluded;
  });

  protected lineTotal(line: CartLine): number {
    return Number(line.unitPrice ?? 0) * line.quantity;
  }

  protected resolveName(value: CartLine['productName']): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const locale: Locale = this.localeService.locale();
      const map = value as Record<string, string | undefined>;
      return map[locale] ?? map[DEFAULT_LOCALE] ?? '';
    }
    return '';
  }

  protected formatted(value: number): string {
    return formatMoney(value, this.storeConfig.money(), this.resolvedCurrency());
  }
}
