import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Inject, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  TranslatableInputComponent,
} from '@admin-ui';
import {
  ProductsService,
  type CreateProductTypeRequest,
  type ProductType,
  type TaxClass,
} from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';

export interface ProductTypeDialogData {
  mode: 'create' | 'edit';
  productType?: ProductType;
  taxClasses: readonly TaxClass[];
}

export type ProductTypeDialogResult = { kind: 'saved'; productType: ProductType } | null;

const CODE_RE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

@Component({
  selector: 'app-product-type-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full max-w-md h-screen bg-surface border-l border-line flex flex-col"
      data-testid="product-type-dialog"
    >
      <header class="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
        <h2
          id="product-type-dialog-title"
          class="text-lg md:text-xl font-bold tracking-tight text-ink"
        >
          {{ data.mode === 'create' ? 'New product type' : 'Edit product type' }}
        </h2>
        <button
          type="button"
          class="text-xs tracking-widest uppercase text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 px-1"
          aria-label="Close product type dialog"
          (click)="cancel()"
          data-testid="product-type-dialog-close"
        >
          Close
        </button>
      </header>

      <form [formGroup]="form" class="flex-1 overflow-y-auto p-5 flex flex-col gap-5" novalidate>
        <div role="status" aria-live="polite" data-testid="product-type-dialog-error">
          @if (error()) {
            <p class="border border-status-error text-ink p-3 tabular text-xs">
              {{ error() }}
            </p>
          }
        </div>

        <app-form-field label="Name" fieldId="product-type-name" [required]="true">
          <app-translatable-input
            formControlName="name"
            label="Name"
            inputId="product-type-name"
            idPrefix="product-type-name"
            testId="product-type-name"
          ></app-translatable-input>
        </app-form-field>

        <app-form-field
          label="Code"
          fieldId="product-type-code"
          [required]="true"
          [error]="codeError()"
          hint="Lowercase letters, digits, hyphens or underscores only. Used as a stable reference."
        >
          <app-input
            id="product-type-code"
            type="text"
            formControlName="code"
            [invalid]="!!codeError()"
          ></app-input>
        </app-form-field>

        <app-form-field
          label="Tax class"
          fieldId="product-type-tax-class"
          hint="Optional. Drives how tax is applied to products of this type."
        >
          <select
            id="product-type-tax-class"
            class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed"
            formControlName="taxClassId"
            data-testid="product-type-tax-class-select"
          >
            <option [ngValue]="null">— None —</option>
            @for (tc of data.taxClasses; track tc.id) {
              <option [ngValue]="tc.id">{{ tc.name }}</option>
            }
          </select>
        </app-form-field>
      </form>

      <footer class="px-5 py-4 border-t border-line flex items-center justify-end gap-3 bg-surface">
        <app-button
          type="button"
          variant="ghost"
          size="sm"
          [disabled]="busy()"
          (clicked)="cancel()"
          data-testid="product-type-dialog-cancel"
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
          data-testid="product-type-dialog-submit"
        >
          {{ data.mode === 'create' ? 'Create' : 'Save' }}
        </app-button>
      </footer>
    </div>
  `,
})
export class ProductTypeDialogComponent {
  private readonly service = inject(ProductsService);
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject<DialogRef<ProductTypeDialogResult>>(DialogRef);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control<{ default: string; [loc: string]: string }>({ default: '' }, [
      translatableRequired,
    ]),
    code: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(CODE_RE)]),
    taxClassId: this.fb.control<string | null>(null),
  });

  constructor(@Inject(DIALOG_DATA) public readonly data: ProductTypeDialogData) {
    if (data.mode === 'edit' && data.productType) {
      this.form.patchValue({
        name: data.productType.name,
        code: data.productType.code,
        taxClassId: data.productType.taxClassId ?? null,
      });
    }
  }

  codeError(): string | null {
    const c = this.form.controls.code;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Code is required.';
    if (c.hasError('pattern'))
      return 'Code must be lowercase letters, digits, hyphens or underscores.';
    return null;
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;

    const raw = this.form.getRawValue();
    const body: CreateProductTypeRequest = {
      name: raw.name,
      code: raw.code.trim(),
      ...(raw.taxClassId ? { taxClassId: raw.taxClassId } : {}),
    };

    this.busy.set(true);
    this.error.set(null);
    const request$ =
      this.data.mode === 'create'
        ? this.service.createProductType(body)
        : this.service.updateProductType(this.data.productType!.id, body);

    request$.subscribe({
      next: (productType) => {
        this.busy.set(false);
        this.ref.close({ kind: 'saved', productType });
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

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to save product types.';
    if (err instanceof ApiNotFoundError) return 'Product type not found.';
    if (err instanceof ApiConflictError)
      return err.message || 'A product type with this code already exists.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save the product type. Please retry.';
  }
}
