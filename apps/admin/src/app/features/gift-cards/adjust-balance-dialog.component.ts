import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import {
  GiftCardsService,
  type AdjustGiftCardBalanceRequest,
  type GiftCard,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import { formatMoney as sharedFormatMoney } from '../../shared/format/money';
import { moneyScaleFactor } from '@admin-types';
import { CurrencyStore } from '../../core/stores/currency.store';
import { MoneyAffixStore } from '../../core/stores/money-affix.store';

export interface AdjustBalanceDialogData {
  giftCardId: string;
  currency: string;
  currentBalance: number;
}

export type AdjustBalanceDialogResult = { kind: 'saved'; card: GiftCard } | null;

/**
 * Dedicated side-panel for balance adjustments. The confirm dialog doesn't
 * fit — we need two inputs (signed amount + reason) plus error mapping for
 * the 400 "insufficient balance" case the backend returns on over-debit.
 *
 * The amount field is a plain number input: positive credits, negative
 * debits. The helper hint spells out the rule so operators don't have to
 * guess from the "Adjust" button copy.
 */
@Component({
  selector: 'app-adjust-balance-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full max-w-md h-screen bg-surface border-l border-line flex flex-col"
      data-testid="adjust-balance-dialog"
    >
      <header class="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 [id]="titleId" class="text-lg md:text-xl font-bold tracking-tight text-ink">
            Adjust balance
          </h2>
          <p [id]="subtitleId" class="mt-1 text-xs tabular text-ink-muted">
            Current: {{ formatMoney(data.currentBalance, data.currency) }}
          </p>
        </div>
        <button
          type="button"
          class="text-xs tracking-widest uppercase text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 px-1"
          aria-label="Close balance adjustment"
          (click)="cancel()"
          data-testid="adjust-balance-close"
        >
          Close
        </button>
      </header>

      <form [formGroup]="form" class="flex-1 overflow-y-auto p-5 flex flex-col gap-5" novalidate>
        <div role="status" aria-live="polite" data-testid="adjust-balance-error">
          @if (error()) {
            <p class="border border-status-error text-ink p-3 tabular text-xs">
              {{ error() }}
            </p>
          }
        </div>

        <app-form-field
          label="Amount"
          fieldId="adjust-amount"
          [required]="true"
          [error]="amountError()"
          [hint]="
            'Positive to credit, negative to debit, up to ' +
            decimalPlaces() +
            ' decimal places. Amount in ' +
            data.currency +
            '.'
          "
        >
          <app-input
            id="adjust-amount"
            type="number"
            [step]="amountStep()"
            inputmode="decimal"
            formControlName="amount"
            [invalid]="!!amountError()"
            [prefix]="recordAffix().prefix"
            [suffix]="recordAffix().suffix"
          ></app-input>
        </app-form-field>

        <app-form-field
          label="Reason"
          fieldId="adjust-reason"
          [required]="true"
          [error]="reasonError()"
          hint="Shown in the ledger; operators see this during audits."
        >
          <app-input
            id="adjust-reason"
            type="text"
            formControlName="reason"
            [invalid]="!!reasonError()"
          ></app-input>
        </app-form-field>
      </form>

      <footer class="px-5 py-4 border-t border-line flex items-center justify-end gap-3 bg-surface">
        <app-button
          type="button"
          variant="ghost"
          size="sm"
          [disabled]="busy()"
          (clicked)="cancel()"
          data-testid="adjust-balance-cancel"
        >
          Cancel
        </app-button>
        <app-button
          type="button"
          variant="primary"
          size="md"
          [disabled]="form.invalid || busy()"
          [loading]="busy()"
          (clicked)="submit()"
          data-testid="adjust-balance-submit"
        >
          Apply adjustment
        </app-button>
      </footer>
    </div>
  `,
})
export class AdjustBalanceDialogComponent {
  private readonly service = inject(GiftCardsService);
  private readonly currencyStore = inject(CurrencyStore);
  private readonly moneyAffix = inject(MoneyAffixStore);

  /** The card's own currency, on the side the store writes its money. */
  protected readonly recordAffix = computed(() => this.moneyAffix.affixesFor(this.data.currency));

  /**
   * The scale the operator may actually type, from the store currency.
   * The hint hardcoded "up to 2 decimal places" and the input carried no
   * step at all, so on a three-decimal currency the copy was wrong and the
   * field silently behaved as step=1.
   */
  protected readonly decimalPlaces = this.currencyStore.decimalPlaces;
  protected readonly amountStep = computed(
    () => 1 / moneyScaleFactor(this.currencyStore.decimalPlaces()),
  );
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject<DialogRef<AdjustBalanceDialogResult>>(DialogRef);

  protected readonly titleId = `adjust-balance-title-${Math.random().toString(36).slice(2, 8)}`;
  readonly subtitleId = `adjust-balance-subtitle-${Math.random().toString(36).slice(2, 8)}`;

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** Surfaces the zero-rejection as a field-level error so AT picks it up
   *  via the parent FormField's describedBy wiring, instead of only at
   *  submit time via the banner. */
  private readonly nonZero = (c: { value: unknown }): { nonZero: true } | null => {
    const v = Number(c.value);
    return Number.isFinite(v) && v !== 0 ? null : { nonZero: true };
  };

  readonly form = this.fb.nonNullable.group({
    amount: this.fb.nonNullable.control(0, [Validators.required, this.nonZero]),
    reason: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.minLength(3),
      Validators.maxLength(500),
    ]),
  });

  constructor(@Inject(DIALOG_DATA) public readonly data: AdjustBalanceDialogData) {}

  amountError(): string | null {
    const c = this.form.controls.amount;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Amount is required.';
    if (c.hasError('nonZero')) return 'Amount must be a non-zero number.';
    return null;
  }

  reasonError(): string | null {
    const c = this.form.controls.reason;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Reason is required.';
    if (c.hasError('minlength')) return 'Reason must be at least 3 characters.';
    if (c.hasError('maxlength')) return 'Reason must be 500 characters or fewer.';
    return null;
  }

  submit(): void {
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    const amount = Number(raw.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      this.error.set('Amount must be a non-zero number.');
      return;
    }
    if (this.form.invalid || this.busy()) return;

    const body: AdjustGiftCardBalanceRequest = {
      amount,
      reason: raw.reason.trim(),
    };

    this.busy.set(true);
    this.error.set(null);
    this.service.adjustBalance(this.data.giftCardId, body).subscribe({
      next: (card) => {
        this.busy.set(false);
        this.ref.close({ kind: 'saved', card });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  cancel(): void {
    this.ref.close(null);
  }

  /** Record currency: the card was written in it, so it renders in it. */
  protected readonly formatMoney = sharedFormatMoney;

  private formatError(err: unknown): string {
    if (err instanceof ApiValidationError)
      return err.message || 'Adjustment rejected by the server.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to adjust balances.';
    if (err instanceof ApiNotFoundError) return 'This gift card no longer exists.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not apply the adjustment. Please retry.';
  }
}
