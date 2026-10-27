import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';

import type { StorefrontPaymentMethod } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { ButtonComponent } from '../../ui/button.component';

/**
 * Checkout payment-method chooser (findings K2 payment half, D2, D3).
 *
 * The payment-methods admin module was dead config: every endpoint was
 * admin-gated, nothing on the storefront read it, and checkout printed a
 * hardcoded cash-on-delivery note whatever the operator had configured. This
 * renders the operator's enabled set, which `GET /v1/checkout/settings`
 * projects without the secrets-bearing `config` column.
 *
 * Reflection only: it integrates no gateway and captures no payment. The
 * empty state refuses rather than assuming cash, which is the D2 complaint.
 */
@Component({
  selector: 'app-payment-method-step',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (checkoutMessage()) {
      <p class="operator-note" data-testid="checkout-message">{{ checkoutMessage() }}</p>
    }
    @if (loading()) {
      <p class="state" role="status" aria-live="polite" data-testid="payment-method-loading">
        {{ strings().checkout.steps.payment.loading }}
      </p>
    } @else if (failed()) {
      <div class="state" role="alert" data-testid="payment-method-error">
        <p>{{ strings().checkout.steps.payment.error }}</p>
        <app-button variant="secondary" (clicked)="retryRequested.emit()">
          <span data-testid="payment-method-retry">{{
            strings().checkout.steps.payment.retry
          }}</span>
        </app-button>
      </div>
    } @else if (methods().length === 0) {
      <p class="state" role="alert" data-testid="payment-method-empty">
        {{ strings().checkout.steps.payment.empty }}
      </p>
    } @else {
      <fieldset class="group">
        <legend class="legend">{{ strings().checkout.steps.payment.legend }}</legend>
        @for (method of methods(); track method.code) {
          <label class="option" [attr.data-testid]="'payment-method-option-' + method.code">
            <input
              type="radio"
              name="payment-method"
              [value]="method.code"
              [checked]="method.code === selectedCode()"
              (change)="methodSelected.emit(method.code)"
            />
            <span class="body">
              <span class="name">{{ method.name }}</span>
              @if (method.description) {
                <span class="description">{{ method.description }}</span>
              }
            </span>
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
      .operator-note {
        margin: 0 0 1rem;
        color: var(--brand-text);
        font-size: var(--brand-text-body);
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
        grid-template-columns: auto 1fr;
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
      .description {
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
    `,
  ],
})
export class PaymentMethodStepComponent {
  readonly methods = input<StorefrontPaymentMethod[]>([]);
  readonly selectedCode = input<string | null>(null);
  readonly loading = input<boolean>(false);
  readonly failed = input<boolean>(false);
  /**
   * The operator's `checkoutMessage`, rendered above the tenders exactly where
   * its own DTO comment says it belongs. A plain string, not Translatable:
   * upgrading the storage shape is admin-side work, so it renders verbatim
   * under both locales (decision K-F6).
   */
  readonly checkoutMessage = input<string | null>(null);

  @Output() readonly methodSelected = new EventEmitter<string>();
  @Output() readonly retryRequested = new EventEmitter<void>();

  private readonly localeService = inject(LocaleService);
  protected readonly strings = this.localeService.strings;

  /** True when the customer has a tender to pay with. */
  readonly hasSelection = computed(() => Boolean(this.selectedCode()));
}
