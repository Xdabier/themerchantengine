import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { Cart } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { DEFAULT_LOCALE } from '../../../i18n/types';
import { APP_ROUTES } from '../../../lib/routes';
import { formatMoney } from '../../../lib/money';
import { StoreConfigService } from '../../services/store-config.service';
import { resolveDiscountLabel } from './discount-label';

@Component({
  selector: 'cart-totals',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="totals"
      [attr.aria-label]="strings().cart.page.totalsRegionLabel"
      data-testid="cart-totals"
    >
      <dl class="rows" aria-live="polite" aria-atomic="true">
        <div class="row">
          <dt>{{ strings().cart.page.subtotal }}</dt>
          <dd>
            <span>{{ formatted(subtotalNumber()) }}</span>
          </dd>
        </div>

        @for (line of discountLines(); track line.key) {
          <div class="row discount" data-testid="cart-totals-discount" [attr.data-type]="line.type">
            <dt>{{ line.label }}</dt>
            <dd>
              <span>-{{ formatted(line.amount) }}</span>
            </dd>
          </div>
        }

        <div class="row" data-testid="cart-totals-shipping">
          <dt>{{ strings().cart.page.shipping }}</dt>
          <dd>
            @if (shippingIsFree()) {
              <span data-testid="cart-totals-shipping-free">{{
                strings().cart.page.shippingFree
              }}</span>
            } @else if (shippingNumber() != null) {
              <span>{{ formatted(shippingNumber()!) }}</span>
              <span class="qualifier" data-testid="cart-totals-shipping-estimate-label">{{
                strings().cart.page.shippingEstimateLabel
              }}</span>
            } @else {
              <span class="hint">{{ strings().cart.page.shippingEstimate }}</span>
            }
          </dd>
        </div>

        @if (taxNumber() != null && taxNumber()! > 0) {
          <div class="row">
            <dt>{{ strings().cart.page.tax }}</dt>
            <dd>
              <span>{{ formatted(taxNumber()!) }}</span>
            </dd>
          </div>
        }

        <div class="row total">
          <dt>{{ strings().cart.page.total }}</dt>
          <dd>
            <span data-testid="cart-totals-grand">{{ formatted(totalNumber()) }}</span>
            @if (taxMention(); as mention) {
              <span class="tax-mention" data-testid="cart-totals-tax-mention">{{ mention }}</span>
            }
          </dd>
        </div>

        @if (giftCardApplied(); as applied) {
          <div class="row discount" data-testid="cart-totals-gift-card">
            <dt>{{ strings().cart.page.giftCardRow }} ({{ applied.code }})</dt>
            <dd>
              <span>-{{ formatted(applied.amount) }}</span>
            </dd>
          </div>
          <div class="row total" data-testid="cart-totals-payable">
            <dt>{{ strings().cart.page.amountPayable }}</dt>
            <dd>
              <span>{{ formatted(payableNumber()) }}</span>
            </dd>
          </div>
        }
      </dl>

      @if (freeShippingRemainingHint(); as nudge) {
        <p class="vat-hint" data-testid="cart-totals-free-shipping-progress">{{ nudge }}</p>
      }

      @if (showVatHint()) {
        <p class="vat-hint" data-testid="cart-totals-vat-hint">{{ vatHint() }}</p>
      }

      <a
        [routerLink]="checkoutHref()"
        class="checkout-cta"
        [class.disabled]="checkoutDisabled()"
        [attr.aria-disabled]="checkoutDisabled() ? 'true' : null"
        [attr.tabindex]="checkoutDisabled() ? -1 : null"
        data-testid="cart-checkout-cta"
        (click)="onCheckoutClick($event)"
      >
        {{ strings().cart.page.proceedToCheckout }}
      </a>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .totals {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding-block: 1.25rem;
        padding-inline: 1.25rem;
        background-color: var(--brand-surface-strong);
        border-radius: var(--brand-radius-md);
      }
      .rows {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
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
      /* agent_docs/storefront/brand-tokens.md — mandatory wherever numbers stack, and a totals
         column is the case it names first. */
      .row dd {
        font-variant-numeric: tabular-nums;
      }
      .tax-mention {
        margin-inline-start: 0.375rem;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text-muted);
      }
      /* Audit row 7: the success colour means in stock, shipped, or paid.
         A discount is a promotion, not a state, so the amount carries no
         state colour. Weight alone distinguishes it. */
      .row.discount dd {
        color: var(--brand-text);
        font-weight: 600;
      }
      .row.total {
        padding-block-start: 0.75rem;
        border-block-start: 1px solid var(--brand-border);
        font-weight: 600;
        font-size: var(--brand-text-product);
      }
      .hint {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .qualifier {
        margin-inline-start: 0.375rem;
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .vat-hint {
        margin: 0;
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .checkout-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 100%;
        min-block-size: 52px;
        padding-block: 0.875rem;
        padding-inline: 1.5rem;
        font: inherit;
        font-size: var(--brand-text-product);
        font-weight: 600;
        background-color: var(--brand-primary);
        color: var(--brand-on-primary);
        border: 1px solid var(--brand-primary);
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        cursor: pointer;
        transition: background-color var(--brand-motion-duration) var(--brand-motion-easing);
      }
      .checkout-cta:not(.disabled):hover,
      .checkout-cta:not(.disabled):focus-visible {
        background-color: var(--brand-primary-dark);
      }
      .checkout-cta:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      .checkout-cta.disabled {
        opacity: 0.55;
        cursor: not-allowed;
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .checkout-cta {
          transition: none;
        }
      }
    `,
  ],
})
export class CartTotalsComponent {
  private readonly localeService = inject(LocaleService, { optional: true });

  readonly cart = input.required<Cart>();
  readonly currency = input<string>('');

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
  readonly pending = input<boolean>(false);

  readonly checkoutClicked = output<void>();

  protected readonly strings = computed(
    () => this.localeService?.strings() ?? ({ cart: { page: {} } } as never),
  );

  protected readonly subtotalNumber = computed(() => Number(this.cart().subtotal ?? 0));
  /**
   * One row per `discounts[]` entry, each carrying the promotion's own name.
   *
   * The totals block used to sum the array into a single anonymous "Discount"
   * row. With an automatic promotion running alongside a coupon that reads as
   * a lie: the coupon box named one figure and the totals named a much larger
   * one, with nothing on screen accounting for the difference.
   *
   * Zero-amount entries are dropped rather than rendered as `-0,000 DT`. The
   * engine emits FREE_SHIPPING as a zero-amount signal line, honoured on the
   * shipping row, not as money taken off the goods.
   *
   * The merged fallback survives for the case where a response carries the
   * scalar `discountAmount` with no lines to name.
   */
  protected readonly discountLines = computed(() => {
    const locale = this.localeService?.locale() ?? DEFAULT_LOCALE;
    const cart = this.cart();
    const lines = (cart.discounts ?? [])
      .map((d, index) => ({
        key: d.promotionId || `${d.type}-${index}`,
        type: d.type,
        label: resolveDiscountLabel(d.label, locale, this.strings().cart.page.discount),
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
            label: this.strings().cart.page.discount,
            amount: explicit,
          },
        ]
      : [];
  });
  // `shippingEstimate` and `taxEstimate` are the names the API actually emits
  // (CartResponse). These read `shippingAmount` and `taxAmount`, which the API
  // has never sent, and `cartSchema` declared BOTH spellings optional behind a
  // `.passthrough()`, so the parse succeeded and the values were silently
  // undefined — the tax row could not render at any rate.
  protected readonly shippingNumber = computed(() => {
    const v = this.cart().shippingEstimate;
    return v == null ? null : Number(v);
  });
  protected readonly taxNumber = computed(() => {
    const v = this.cart().taxEstimate;
    return v == null ? null : Number(v);
  });
  // The cart quotes HT per `plan.md` §2.2: `grandTotal` is goods less discount
  // plus shipping, with no VAT in it. The TTC figure belongs at checkout, once
  // a delivery country has resolved a tax zone.
  protected readonly totalNumber = computed(() =>
    Number(this.cart().grandTotal ?? this.cart().total ?? 0),
  );

  /**
   * The cart quotes HT, so it owes the shopper a line saying VAT is still to
   * come. Without it the checkout total reads as a price rise rather than the
   * same basket with tax resolved.
   *
   * Dropped once a real `taxEstimate` has resolved: at that point the VAT row
   * carries the actual figure and a hint about a future charge would be wrong.
   * A TTC figure deliberately does not appear here; `plan.md` §2.2 put it at
   * checkout.
   */
  /**
   * A zero estimate means a FREE_SHIPPING promotion applied, not a missing
   * value. Printing "0,000 DT" reads as the latter, so the row says what
   * actually happened, and it is not qualified as an estimate: the delivery
   * address cannot revise a free rate back up.
   */
  protected readonly shippingIsFree = computed(() => this.shippingNumber() === 0);

  /**
   * How much more the basket needs to earn free delivery.
   *
   * `freeShippingProgress` has been in the cart response from the start and
   * nothing rendered it, so a basket a few dinars short of the threshold said
   * nothing at all. Null once the basket qualifies, since the shipping row
   * then says Free, and null when the store has no threshold configured.
   */
  protected readonly freeShippingRemainingHint = computed(() => {
    const progress = this.cart().freeShippingProgress;
    if (!progress || progress.qualified) return null;
    const remaining = progress.remaining == null ? null : Number(progress.remaining);
    if (remaining == null || remaining <= 0) return null;
    return this.strings().cart.page.freeShippingRemaining.replace(
      '{amount}',
      this.formatted(remaining),
    );
  });

  protected readonly showVatHint = computed(() => {
    const tax = this.taxNumber();
    return tax == null || tax === 0;
  });

  protected readonly vatHint = computed(() =>
    this.strings().cart.page.vatAtCheckout.replace(
      '{rate}',
      String(Math.round(this.storeConfig.money().vatRate * 100)),
    ),
  );

  /**
   * The gift card applied on the cart, as tender rather than as a discount.
   *
   * The API re-validates the stored code on every cart read and caps
   * `balanceApplied` at the same base order creation caps against, so the
   * figure shown here is the figure the order deducts. Nothing rendered it,
   * so a shopper with a card applied saw the full total right up to the
   * confirmation page.
   *
   * The goods total above is deliberately left alone: a card does not change
   * what the basket costs, only what is left to pay.
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

  protected readonly checkoutDisabled = computed(
    () => this.pending() || (this.cart().items?.length ?? 0) === 0,
  );

  protected readonly checkoutHref = computed(() => {
    const locale = this.localeService?.locale() ?? DEFAULT_LOCALE;
    return APP_ROUTES.checkout(locale);
  });

  /**
   * The cart total's tax mention, from `money.taxDisplay`.
   *
   * It read the tax-exclusive string unconditionally, which is right only for
   * a store whose catalogue quotes pre-tax prices. A tax-inclusive store was
   * told its own total excluded tax, and a store that shows no mention got one
   * anyway.
   */
  protected readonly taxMention = computed<string | null>(() => {
    const display = this.storeConfig.money().taxDisplay;
    if (display === 'none') return null;
    const generic = this.strings().generic;
    return display === 'TTC' ? generic.taxIncluded : generic.taxExcluded;
  });

  protected formatted(value: number): string {
    return formatMoney(value, this.storeConfig.money(), this.resolvedCurrency());
  }

  protected onCheckoutClick(event: MouseEvent): void {
    if (this.checkoutDisabled()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    this.checkoutClicked.emit();
  }
}
