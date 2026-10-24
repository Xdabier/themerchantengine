import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';

import type { ShippingMethodQuote } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { formatMoney } from '../../../lib/money';
import { StoreConfigService } from '../../services/store-config.service';
import { resolveDiscountLabel } from '../cart/discount-label';
import { ButtonComponent } from '../../ui/button.component';

/** One rendered row of the radio group. */
export interface ShippingMethodOption {
  methodId: string;
  name: string;
  price: number;
  priceLabel: string;
  eta: string | null;
}

/**
 * Checkout shipping-method chooser (findings K2, D3).
 *
 * The zone's rates were already quoted by `GET /v1/cart/estimate` and thrown
 * away: the page called it only to prime the VAT row, so a store with two
 * active methods offered neither and every order silently recorded the zone
 * default. This is the radio group that was missing, and nothing more: the
 * quote fetch, the selection state and the payload all stay on the page.
 *
 * A failed quote renders a retry, never a silent fallback. Falling back to the
 * default would reproduce the exact defect, this time with a chooser on screen
 * to make it look deliberate.
 */
@Component({
  selector: 'app-shipping-method-step',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <p class="state" role="status" aria-live="polite" data-testid="shipping-method-loading">
        {{ strings().checkout.steps.shipping.loading }}
      </p>
    } @else if (failed()) {
      <div class="state" role="alert" data-testid="shipping-method-error">
        <p>{{ strings().checkout.steps.shipping.error }}</p>
        <app-button variant="secondary" (clicked)="retryRequested.emit()">
          <span data-testid="shipping-method-retry">{{
            strings().checkout.steps.shipping.retry
          }}</span>
        </app-button>
      </div>
    } @else if (options().length === 0) {
      <p class="state" role="status" data-testid="shipping-method-empty">
        {{ strings().checkout.steps.shipping.empty }}
      </p>
    } @else {
      <fieldset class="group">
        <legend class="legend">{{ strings().checkout.steps.shipping.legend }}</legend>
        @for (option of options(); track option.methodId) {
          <label class="option" [attr.data-testid]="'shipping-method-option-' + option.methodId">
            <input
              type="radio"
              name="shipping-method"
              [value]="option.methodId"
              [checked]="option.methodId === selectedMethodId()"
              (change)="methodSelected.emit(option.methodId)"
            />
            <span class="body">
              <span class="name">{{ option.name }}</span>
              @if (option.eta) {
                <span class="eta">{{ option.eta }}</span>
              }
            </span>
            <span class="price">{{ option.priceLabel }}</span>
          </label>
        }
      </fieldset>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .state {
        margin: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.75rem;
        color: var(--brand-text);
        font-size: var(--brand-text-body);
      }
      .group {
        margin: 0;
        padding: 0;
        border: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .legend {
        padding: 0;
        margin-block-end: 0.5rem;
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
      .option {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 0.75rem;
        padding-inline: 1rem;
        padding-block: 0.75rem;
        border: 1px solid var(--brand-border);
        cursor: pointer;
        color: var(--brand-text);
        font-size: var(--brand-text-body);
      }
      .option:focus-within {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      .body {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .eta {
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
      /* agent_docs/storefront/brand-tokens.md: any column of amounts aligns on the digits. */
      .price {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
    `,
  ],
})
export class ShippingMethodStepComponent {
  readonly rates = input<ShippingMethodQuote[]>([]);
  readonly selectedMethodId = input<string | null>(null);
  readonly loading = input<boolean>(false);
  readonly failed = input<boolean>(false);
  readonly currency = input<string>('');

  @Output() readonly methodSelected = new EventEmitter<string>();
  @Output() readonly retryRequested = new EventEmitter<void>();

  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  protected readonly strings = this.localeService.strings;

  protected readonly options = computed<ShippingMethodOption[]>(() => {
    const locale = this.localeService.locale();
    const s = this.strings().checkout.steps.shipping;
    const code = this.currency() || this.storeConfig.currencyCode();
    const money = this.storeConfig.money();
    return (this.rates() ?? []).map((rate) => {
      const price = Number(rate.price ?? 0);
      return {
        methodId: rate.methodId,
        // The API sends the method's Translatable; interpolating it raw is the
        // `[object Object]` class of defect (finding AD2).
        name: resolveDiscountLabel(rate.name, locale, s.title),
        price,
        priceLabel: price > 0 ? formatMoney(price, money, code) : s.free,
        eta: formatEta(rate, s.etaOne, s.etaRange),
      };
    });
  });
}

/** `2 to 4 days`, `1 day`, or nothing when the method quotes no window. */
function formatEta(rate: ShippingMethodQuote, one: string, range: string): string | null {
  const min = rate.estimatedDaysMin ?? null;
  const max = rate.estimatedDaysMax ?? null;
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) {
    return range.replace('{min}', String(min)).replace('{max}', String(max));
  }
  const days = min ?? max;
  return days == null ? null : one.replace('{days}', String(days));
}
