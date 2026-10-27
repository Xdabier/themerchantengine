import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import {
  ProductsService,
  type CreateVariantRequest,
  type UpdateVariantRequest,
  type Variant,
} from '@admin-services';
import {
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  moneyScaleFactor,
} from '@admin-types';
import { CurrencyStore } from '../../core/stores/currency.store';
import { MoneyAffixStore } from '../../core/stores/money-affix.store';

export interface VariantDialogData {
  productId: string;
  /** Existing variant when editing; omit for create. */
  variant: Variant | null;
}

export type VariantDialogResult =
  | { kind: 'saved'; variant: Variant }
  | { kind: 'deleted'; variantId: string }
  | null;

/**
 * Side-panel dialog hosting the variant form. Reuses `@angular/cdk/dialog`
 * for focus trap + Esc-to-close + backdrop click handling.
 *
 * Create vs edit is decided from `data.variant`; `null` → POST a new
 * variant, otherwise PATCH the existing one. Delete is only offered when
 * editing an existing variant and never for the last active variant (the
 * backend blocks that with a 409; we surface the error inline).
 */
@Component({
  selector: 'app-variant-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full max-w-md h-screen bg-surface border-l border-line flex flex-col"
      data-testid="variant-dialog"
    >
      <header class="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 [id]="titleId" class="text-lg md:text-xl font-bold tracking-tight text-ink">
            {{ data.variant ? 'Edit variant' : 'New variant' }}
          </h2>
          <p class="mt-1 text-xs tabular text-ink-muted">
            {{ data.variant?.sku ?? 'Create a new SKU under this product.' }}
          </p>
        </div>
        <button
          type="button"
          class="text-xs tracking-widest uppercase text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 px-1"
          aria-label="Close variant editor"
          (click)="cancel()"
          data-testid="variant-dialog-close"
        >
          Close
        </button>
      </header>

      <form [formGroup]="form" class="flex-1 overflow-y-auto p-5 flex flex-col gap-5" novalidate>
        @if (error()) {
          <p
            class="border border-status-error text-ink p-3 tabular text-xs"
            data-testid="variant-dialog-error"
            role="alert"
          >
            {{ error() }}
          </p>
        }

        <app-form-field label="SKU" fieldId="variant-sku" [required]="true" [error]="skuError()">
          <app-input
            id="variant-sku"
            type="text"
            formControlName="sku"
            [invalid]="!!skuError()"
          ></app-input>
        </app-form-field>

        <app-form-field
          label="Price"
          fieldId="variant-price"
          [required]="true"
          [hint]="amountHint()"
          [error]="priceError()"
        >
          <app-input
            id="variant-price"
            type="number"
            [step]="moneyStep()"
            formControlName="price"
            [invalid]="!!priceError()"
            [inputmode]="'decimal'"
            [prefix]="moneyPrefix()"
            [suffix]="moneySuffix()"
          ></app-input>
        </app-form-field>

        <app-form-field
          label="Compare-at price"
          fieldId="variant-compare-at"
          [hint]="'Shown struck-through next to the active price. ' + amountHint()"
        >
          <app-input
            id="variant-compare-at"
            type="number"
            [step]="moneyStep()"
            formControlName="compareAtPrice"
            [inputmode]="'decimal'"
            [prefix]="moneyPrefix()"
            [suffix]="moneySuffix()"
          ></app-input>
        </app-form-field>

        <app-form-field
          label="Cost price"
          fieldId="variant-cost"
          [hint]="'Internal, never shown to customers. ' + amountHint()"
        >
          <app-input
            id="variant-cost"
            type="number"
            [step]="moneyStep()"
            formControlName="costPrice"
            [inputmode]="'decimal'"
            [prefix]="moneyPrefix()"
            [suffix]="moneySuffix()"
          ></app-input>
        </app-form-field>

        <app-form-field label="Weight (kg)" fieldId="variant-weight">
          <app-input
            id="variant-weight"
            type="number"
            formControlName="weight"
            [inputmode]="'decimal'"
          ></app-input>
        </app-form-field>

        <app-form-field label="Barcode" fieldId="variant-barcode">
          <app-input id="variant-barcode" type="text" formControlName="barcode"></app-input>
        </app-form-field>

        <div class="flex items-center gap-6 flex-wrap">
          <label class="inline-flex items-center gap-3 text-sm tabular">
            <input
              type="checkbox"
              formControlName="isActive"
              class="h-4 w-4 accent-ink"
              data-testid="variant-dialog-active"
            />
            Active
          </label>
          <label class="inline-flex items-center gap-3 text-sm tabular">
            <input
              type="checkbox"
              formControlName="isDefault"
              class="h-4 w-4 accent-ink"
              data-testid="variant-dialog-default"
            />
            Default variant
          </label>
        </div>
      </form>

      <footer class="px-5 py-4 border-t border-line flex items-center justify-between gap-3">
        @if (data.variant) {
          <app-button
            variant="destructive"
            size="sm"
            [disabled]="busy()"
            [loading]="busy() && action() === 'delete'"
            (clicked)="delete()"
            data-testid="variant-dialog-delete"
          >
            Delete variant
          </app-button>
        } @else {
          <span></span>
        }
        <div class="flex items-center gap-3">
          <app-button variant="ghost" size="sm" [disabled]="busy()" (clicked)="cancel()">
            Cancel
          </app-button>
          <app-button
            variant="primary"
            size="sm"
            [disabled]="form.invalid || busy()"
            [loading]="busy() && action() !== 'delete'"
            (clicked)="save()"
            data-testid="variant-dialog-save"
          >
            {{ data.variant ? 'Save changes' : 'Create variant' }}
          </app-button>
        </div>
      </footer>
    </div>
  `,
})
export class VariantDialogComponent implements OnInit {
  private readonly dialogRef = inject(DialogRef<VariantDialogResult>);
  private readonly productsService = inject(ProductsService);
  private readonly fb = inject(FormBuilder);

  /**
   * Step the money fields by the store currency's own scale. The atom defaulted
   * to `step=1`, so under a three-decimal currency a legal price could not be
   * typed at all.
   */
  protected readonly moneyStep = computed(
    () => 1 / moneyScaleFactor(this.currencyStore.decimalPlaces()),
  );

  private readonly currencyStore = inject(CurrencyStore);

  /** Suffix for the money fields. Empty while the store currency is unknown. */
  protected readonly storeCode = this.currencyStore.code;
  /** The configured symbol and the side the store writes it on. */
  private readonly moneyAffix = inject(MoneyAffixStore);
  protected readonly moneyPrefix = this.moneyAffix.prefix;
  protected readonly moneySuffix = this.moneyAffix.suffix;

  /**
   * The suffix is aria-hidden decoration, so the unit has to reach screen
   * readers through the hint instead.
   */
  protected amountHint(): string {
    const code = this.storeCode();
    return code ? `Amount in ${code}.` : '';
  }

  readonly titleId = `variant-dialog-${Math.random().toString(36).slice(2, 8)}`;
  readonly busy = signal(false);
  readonly action = signal<'save' | 'delete' | null>(null);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    sku: ['', [Validators.required, Validators.minLength(1)]],
    price: [0, [Validators.required, Validators.min(0)]],
    compareAtPrice: [null as number | null],
    costPrice: [null as number | null],
    weight: [null as number | null],
    barcode: [''],
    isActive: [true],
    isDefault: [false],
  });

  constructor(@Inject(DIALOG_DATA) public data: VariantDialogData) {}

  ngOnInit(): void {
    if (this.data.variant) {
      const v = this.data.variant;
      this.form.reset({
        sku: v.sku,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice == null ? null : Number(v.compareAtPrice),
        costPrice: v.costPrice == null ? null : Number(v.costPrice),
        weight: v.weight == null ? null : Number(v.weight),
        barcode: v.barcode ?? '',
        isActive: v.isActive,
        isDefault: v.isDefault,
      });
    }
  }

  skuError(): string | null {
    const c = this.form.controls.sku;
    if (!c.touched || c.valid) return null;
    return 'SKU is required.';
  }

  priceError(): string | null {
    const c = this.form.controls.price;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Price is required.';
    if (c.hasError('min')) return 'Price must be zero or positive.';
    return null;
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;

    const raw = this.form.getRawValue();
    const body: CreateVariantRequest = {
      sku: raw.sku,
      price: Number(raw.price),
      compareAtPrice: raw.compareAtPrice == null ? undefined : Number(raw.compareAtPrice),
      costPrice: raw.costPrice == null ? undefined : Number(raw.costPrice),
      weight: raw.weight == null ? undefined : Number(raw.weight),
      barcode: raw.barcode || undefined,
      isActive: raw.isActive,
      isDefault: raw.isDefault,
    };

    this.busy.set(true);
    this.action.set('save');
    this.error.set(null);

    const request$ = this.data.variant
      ? this.productsService.updateVariant(
          this.data.productId,
          this.data.variant.id,
          body as UpdateVariantRequest,
        )
      : this.productsService.createVariant(this.data.productId, body);

    request$.subscribe({
      next: (variant) => {
        this.busy.set(false);
        this.action.set(null);
        this.dialogRef.close({ kind: 'saved', variant });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.action.set(null);
        this.error.set(this.formatError(err, 'Could not save variant.'));
      },
    });
  }

  delete(): void {
    if (!this.data.variant || this.busy()) return;
    this.busy.set(true);
    this.action.set('delete');
    this.error.set(null);
    this.productsService.deleteVariant(this.data.productId, this.data.variant.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.action.set(null);
        this.dialogRef.close({
          kind: 'deleted',
          variantId: this.data.variant!.id,
        });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.action.set(null);
        this.error.set(this.formatError(err, 'Could not delete variant.'));
      },
    });
  }

  private formatError(err: unknown, fallback: string): string {
    if (err instanceof ApiConflictError)
      return 'Last active variant cannot be deleted — keep at least one.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to change variants.';
    if (err instanceof ApiNotFoundError) return 'Variant not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
