import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import type { CartLine } from '@storefront-types';
import { pickTranslation } from '@storefront-types';

import { DEFAULT_LOCALE } from '../../../i18n/types';
import { LocaleService } from '../../locale.service';
import { ButtonComponent } from '../../ui/button.component';
import { PictureComponent } from '../../ui/picture.component';
import { PriceComponent } from '../../ui/price.component';
import { StepperComponent } from '../../ui/stepper.component';
import { formatMoney } from '../../../lib/money';
import { StoreConfigService } from '../../services/store-config.service';

export interface CartLineQtyChange {
  itemId: string;
  quantity: number;
}

@Component({
  selector: 'cart-line',
  standalone: true,
  imports: [ButtonComponent, PictureComponent, PriceComponent, StepperComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="line"
      [attr.data-testid]="'cart-line-' + line().id"
      data-testid-shared="cart-line"
    >
      <div class="image">
        <app-picture
          [src]="imageSrc() ?? ''"
          [alt]="productNameText()"
          aspectRatio="1 / 1"
          [width]="120"
          [height]="120"
        />
      </div>

      <div class="meta">
        <h2 class="name">{{ productNameText() }}</h2>
        <app-price
          [amount]="unitPriceNumber()"
          [currency]="resolvedCurrency()"
          taxMention="excluded"
        />
        <p class="line-total" [attr.aria-label]="strings().cart.page.lineTotal">
          <span class="line-total-label">{{ strings().cart.page.lineTotal }}:</span>
          <span class="line-total-amount">{{ formattedLineTotal() }}</span>
          @if (lineTaxMention(); as mention) {
            <span class="tax-mention">{{ mention }}</span>
          }
        </p>
      </div>

      <div class="actions">
        <app-stepper
          [value]="line().quantity"
          [min]="1"
          [max]="stockMax()"
          [disabled]="disabled()"
          [groupLabel]="strings().cart.page.qtyLabel"
          [incrementLabel]="strings().cart.page.qtyIncrease"
          [decrementLabel]="strings().cart.page.qtyDecrease"
          (valueChange)="onQtyChange($event)"
          [attr.data-testid]="'cart-line-stepper-' + line().id"
        />

        <app-button
          variant="tertiary"
          size="sm"
          [ariaLabel]="removeAriaLabel()"
          [attr.data-testid]="'cart-line-remove-' + line().id"
          [disabled]="disabled()"
          (clicked)="remove.emit(line().id)"
        >
          {{ strings().cart.page.removeLine }}
        </app-button>

        @if (authed()) {
          <app-button
            variant="tertiary"
            size="sm"
            [attr.data-testid]="'cart-line-save-' + line().id"
            [disabled]="disabled()"
            (clicked)="saveForLater.emit(line().id)"
          >
            {{ strings().cart.page.saveForLaterAction }}
          </app-button>
        }
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .line {
        display: grid;
        grid-template-columns: 96px 1fr;
        gap: 1rem;
        padding-block: 1rem;
        border-block-end: 1px solid var(--brand-border);
        align-items: start;
      }
      @media (min-width: 768px) {
        .line {
          grid-template-columns: 120px minmax(0, 1fr) auto;
          gap: 1.25rem;
        }
      }
      .image {
        inline-size: 96px;
        block-size: 96px;
        background-color: var(--brand-bg);
        border-radius: var(--brand-radius-md);
        overflow: hidden;
      }
      @media (min-width: 768px) {
        .image {
          inline-size: 120px;
          block-size: 120px;
        }
      }
      .meta {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        min-inline-size: 0;
      }
      .name {
        margin: 0;
        font-family: var(--brand-font-display); /* agent_docs/storefront/brand-tokens.md subtitle */
        font-size: var(--brand-text-product);
        font-weight: 500;
        color: var(--brand-text);
        line-height: 1.3;
      }
      .line-total {
        margin: 0;
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
        display: inline-flex;
        gap: 0.375rem;
      }
      /* agent_docs/storefront/brand-tokens.md — mandatory wherever numbers stack. */
      .line-total-amount {
        font-variant-numeric: tabular-nums;
      }
      .line-total-amount {
        font-weight: 600;
        color: var(--brand-text);
      }
      /* agent_docs/storefront/brand-tokens.md — the unit price above carries its own mention; the
         line total is a second displayed price and needs one too. */
      .tax-mention {
        margin-inline-start: 0.375rem;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text-muted);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        grid-column: 1 / -1;
      }
      @media (min-width: 768px) {
        .actions {
          grid-column: auto;
          flex-direction: column;
          align-items: end;
        }
      }
    `,
  ],
})
export class CartLineComponent {
  private readonly localeService = inject(LocaleService, { optional: true });

  readonly line = input.required<CartLine>();
  readonly disabled = input<boolean>(false);
  readonly authed = input<boolean>(false);
  readonly currency = input<string>('');

  private readonly storeConfig = inject(StoreConfigService);
  /**
   * The line's own tax mention, from `money.taxDisplay`, or null for none.
   * Named apart from the `taxMention` input this component passes to
   * `app-price`, which says what kind of price that is rather than how to
   * label it.
   */
  protected readonly lineTaxMention = computed<string | null>(() => {
    const display = this.storeConfig.money().taxDisplay;
    if (display === 'none') return null;
    const generic = this.strings().generic;
    return display === 'TTC' ? generic.taxIncluded : generic.taxExcluded;
  });

  /**
   * Explicit input first, then the configured store currency. Orders and gift
   * cards carry their own code and must keep it; a caller that passes nothing
   * gets whatever the operator configured.
   */
  protected readonly resolvedCurrency = computed(
    () => this.currency() || this.storeConfig.currencyCode(),
  );

  readonly qtyChange = output<CartLineQtyChange>();
  readonly remove = output<string>();
  readonly saveForLater = output<string>();

  protected readonly strings = computed(
    () => this.localeService?.strings() ?? ({ cart: { page: {} } } as never),
  );

  protected readonly productNameText = computed(() => {
    const name = this.line().productName;
    if (typeof name === 'string') return name;
    const locale = this.localeService?.locale() ?? DEFAULT_LOCALE;
    return pickTranslation(name, locale) ?? '';
  });

  // `thumbnailUrl` is the image field `GET /v1/cart` emits per line. This read
  // `primaryAsset`, a key the cart envelope has never carried, so every line
  // showed the branded no-image asset while the API was sending a real URL.
  // `primaryAsset` stays as the fallback in case a future payload carries it.
  protected readonly imageSrc = computed(() => {
    const line = this.line();
    return line.thumbnailUrl ?? line.primaryAsset?.url ?? null;
  });

  /**
   * Ceiling for the quantity stepper.
   *
   * The cart API sends `stockAvailable` per line and the control was pinned at
   * 99 regardless, so it offered quantities the warehouse could not fill and
   * the shopper only learned that from a server error after the click. Falls
   * back to 99 when the API sends no figure, and never drops below 1 so a
   * line that has just sold out still renders a usable control.
   */
  protected readonly stockMax = computed(() => {
    const available = this.line().stockAvailable;
    if (available == null) return 99;
    return Math.min(99, Math.max(1, available));
  });

  protected readonly unitPriceNumber = computed(() => Number(this.line().unitPrice));
  protected readonly lineTotalNumber = computed(() => Number(this.line().lineTotal));

  protected readonly formattedLineTotal = computed(() => {
    return formatMoney(this.lineTotalNumber(), this.storeConfig.money(), this.resolvedCurrency());
  });

  protected readonly removeAriaLabel = computed(() =>
    this.strings().cart.page.removeLineLabel.replace('{name}', this.productNameText()),
  );

  protected onQtyChange(quantity: number): void {
    if (quantity === this.line().quantity) return;
    this.qtyChange.emit({ itemId: this.line().id, quantity });
  }
}
