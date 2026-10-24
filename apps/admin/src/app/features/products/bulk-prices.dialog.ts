import { CommonModule } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Inject,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ButtonComponent, InputComponent } from '@admin-ui';
import { ProductsService } from '@admin-services';
import {
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  hasMoneyScale,
  moneyScaleFactor,
} from '@admin-types';
import { CurrencyStore } from '../../core/stores/currency.store';
import { MoneyAffixStore } from '../../core/stores/money-affix.store';

export const BULK_PRICES_DIALOG_TITLE_ID = 'bulk-prices-dialog-title';

export interface BulkPriceRow {
  readonly productId: string;
  readonly productName: string;
  readonly variantId: string;
  readonly variantSku: string;
  readonly currentPrice: number;
}

export interface BulkPricesDialogData {
  readonly rows: readonly BulkPriceRow[];
}

export interface BulkPricesDialogResult {
  readonly count: number;
}

/**
 * Reject a price carrying more fraction digits than the store currency has.
 *
 * A factory rather than a bare validator, and named for the rule rather than
 * for a number: the previous `twoDecimalPlacesValidator` encoded the precision
 * in its own identifier, so a currency change meant a rename plus a rewrite,
 * and a three-decimal store rejected the millime an operator is entitled to
 * type. The scale comes from `CurrencyStore.config().decimalPlaces`.
 */
export function moneyScaleValidator(decimalPlaces: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    if (raw === null || raw === undefined || raw === '') return null;
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return { moneyScale: { decimalPlaces } };
    return hasMoneyScale(num, decimalPlaces) ? null : { moneyScale: { decimalPlaces } };
  };
}

@Component({
  selector: 'app-bulk-prices-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      [formGroup]="form"
      (ngSubmit)="submit()"
      class="w-full max-w-2xl bg-surface border border-line p-6 flex flex-col gap-6"
      data-testid="bulk-prices-dialog"
    >
      <header class="flex flex-col gap-2">
        <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
          Update prices for {{ data.rows.length }}
          {{ data.rows.length === 1 ? 'product' : 'products' }}
        </h2>
        <p class="text-sm text-ink-muted">
          Each row edits the default variant price. Prices must be ≥ 0 with at most
          {{ decimalPlaces() }} decimal places.
        </p>
      </header>

      <div class="border border-line">
        <table class="w-full border-collapse" aria-label="Bulk price rows">
          <thead class="border-b border-line">
            <tr class="text-left">
              <th
                scope="col"
                class="text-xs tracking-widest uppercase text-ink-muted font-normal px-3 py-2"
              >
                Product
              </th>
              <th
                scope="col"
                class="text-xs tracking-widest uppercase text-ink-muted font-normal px-3 py-2"
              >
                Variant
              </th>
              <th
                scope="col"
                class="text-xs tracking-widest uppercase text-ink-muted font-normal px-3 py-2"
              >
                New price{{ storeCode() ? ' (' + storeCode() + ')' : '' }}
              </th>
            </tr>
          </thead>
          <tbody formArrayName="prices">
            @for (row of data.rows; track row.variantId; let i = $index) {
              <tr class="border-b border-line last:border-b-0">
                <td class="px-3 py-2 text-sm text-ink">{{ row.productName }}</td>
                <td class="px-3 py-2 text-xs tabular-nums font-mono text-ink-muted">
                  {{ row.variantSku }}
                </td>
                <td class="px-3 py-2">
                  <app-input
                    type="number"
                    [step]="priceStep()"
                    min="0"
                    [invalid]="priceCtrl(i).invalid && priceCtrl(i).touched"
                    [formControl]="priceCtrl(i)"
                    [prefix]="moneyPrefix()"
                    [suffix]="moneySuffix()"
                    [ariaLabel]="
                      'New price' +
                      (storeCode() ? ' in ' + storeCode() : '') +
                      ' for ' +
                      row.productName
                    "
                    [describedBy]="'bulk-price-error-' + i"
                    [attr.data-testid]="'bulk-price-input-' + i"
                  />
                  <p
                    class="mt-1 text-xs text-ink min-h-[1rem]"
                    [id]="'bulk-price-error-' + i"
                    [attr.data-testid]="'bulk-price-error-' + i"
                    [class.sr-only]="!(priceCtrl(i).touched && priceCtrl(i).errors)"
                  >
                    {{ priceCtrl(i).touched && priceCtrl(i).errors ? errorFor(priceCtrl(i)) : ' ' }}
                  </p>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <p
        class="text-xs border p-3 min-h-[2.5rem]"
        [class.border-status-error]="!!errorMessage()"
        [class.border-transparent]="!errorMessage()"
        [class.text-ink]="!!errorMessage()"
        [class.text-ink-muted]="!errorMessage()"
        role="alert"
        data-testid="bulk-prices-error"
      >
        {{ errorMessage() || ' ' }}
      </p>

      <div class="flex items-center justify-end gap-3">
        <app-button
          variant="ghost"
          type="button"
          (clicked)="cancel()"
          data-testid="bulk-prices-cancel"
        >
          Cancel
        </app-button>
        <app-button
          variant="primary"
          type="submit"
          [disabled]="form.invalid || submitting()"
          data-testid="bulk-prices-submit"
        >
          {{ submitting() ? 'Applying…' : 'Apply' }}
        </app-button>
      </div>
    </form>
  `,
})
export class BulkPricesDialogComponent {
  private readonly dialogRef = inject<DialogRef<BulkPricesDialogResult | null>>(DialogRef);
  private readonly products = inject(ProductsService);
  private readonly currencyStore = inject(CurrencyStore);

  /** Unit for the price column. Empty while the store currency is unknown. */
  protected readonly storeCode = this.currencyStore.code;
  /** The configured symbol and the side the store writes it on. */
  private readonly moneyAffix = inject(MoneyAffixStore);
  protected readonly moneyPrefix = this.moneyAffix.prefix;
  protected readonly moneySuffix = this.moneyAffix.suffix;

  /**
   * The native `step`, driven by the store currency rather than hardcoded.
   * `step="0.01"` made the browser's own constraint validation reject a
   * millime before Angular ever saw the value.
   */
  protected readonly decimalPlaces = this.currencyStore.decimalPlaces;
  protected readonly priceStep = computed(
    () => 1 / moneyScaleFactor(this.currencyStore.decimalPlaces()),
  );
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly titleId = BULK_PRICES_DIALOG_TITLE_ID;
  readonly form: FormGroup<{ prices: FormArray<FormControl<number | null>> }>;

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor(@Inject(DIALOG_DATA) public readonly data: BulkPricesDialogData) {
    const controls = data.rows.map(
      (row) =>
        new FormControl<number | null>(row.currentPrice, {
          validators: [
            Validators.required,
            Validators.min(0),
            moneyScaleValidator(this.currencyStore.decimalPlaces()),
          ],
        }),
    );
    this.form = new FormGroup({ prices: new FormArray(controls) });
  }

  priceCtrl(index: number): FormControl<number | null> {
    return this.form.controls.prices.at(index);
  }

  errorFor(ctrl: AbstractControl): string {
    const errors = ctrl.errors ?? {};
    if (errors['required']) return 'Price is required.';
    if (errors['min']) return 'Price must be ≥ 0.';
    const scale = errors['moneyScale'] as { decimalPlaces: number } | undefined;
    if (scale) return `At most ${scale.decimalPlaces} decimal places.`;
    return 'Invalid price.';
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }
    const items = this.data.rows.map((row, i) => ({
      variantId: row.variantId,
      price: this.priceCtrl(i).value as number,
    }));
    if (items.length === 0) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.products
      .bulkUpdatePrices({ items: items as [(typeof items)[0], ...typeof items] })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.dialogRef.close({ count: items.length });
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          this.errorMessage.set(this.formatError(err));
        },
      });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() => {
      const firstInvalid = this.host.nativeElement.querySelector<HTMLInputElement>(
        'input[aria-invalid="true"]',
      );
      firstInvalid?.focus();
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to update prices.';
    if (err instanceof ApiNotFoundError) return 'Product not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not apply price update. Please retry.';
  }
}
