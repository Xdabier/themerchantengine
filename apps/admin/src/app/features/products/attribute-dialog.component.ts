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
  type Attribute,
  type CreateAttributeRequest,
  type ProductType,
} from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { pickTranslation, type Translatable } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

export interface AttributeDialogData {
  mode: 'create' | 'edit';
  attribute?: Attribute;
  productTypes: readonly ProductType[];
  defaultProductTypeId?: string | null;
}

export type AttributeDialogResult = { kind: 'saved'; attribute: Attribute } | null;

const CODE_RE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

function productTypeLabel(pt: ProductType, locale: string, defaultLocale: string): string {
  return pickTranslation(
    pt.name as Translatable | string | null | undefined,
    locale,
    pt.code,
    defaultLocale,
  );
}

@Component({
  selector: 'app-attribute-dialog',
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
      data-testid="attribute-dialog"
    >
      <header class="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
        <h2
          id="attribute-dialog-title"
          class="text-lg md:text-xl font-bold tracking-tight text-ink"
        >
          {{ data.mode === 'create' ? 'New attribute' : 'Edit attribute' }}
        </h2>
        <button
          type="button"
          class="text-xs tracking-widest uppercase text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 px-1"
          aria-label="Close attribute dialog"
          (click)="cancel()"
          data-testid="attribute-dialog-close"
        >
          Close
        </button>
      </header>

      <form [formGroup]="form" class="flex-1 overflow-y-auto p-5 flex flex-col gap-5" novalidate>
        <div role="status" aria-live="polite" data-testid="attribute-dialog-error">
          @if (error()) {
            <p class="border border-status-error text-ink p-3 tabular text-xs">
              {{ error() }}
            </p>
          }
        </div>

        <app-form-field
          label="Product type"
          fieldId="attribute-product-type"
          [required]="true"
          hint="Attributes are scoped to a single product type and cannot be re-parented."
        >
          <select
            id="attribute-product-type"
            class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed"
            formControlName="productTypeId"
            [attr.disabled]="data.mode === 'edit' ? 'true' : null"
            data-testid="attribute-product-type-select"
          >
            <option [ngValue]="null" disabled>— Pick a product type —</option>
            @for (pt of data.productTypes; track pt.id) {
              <option [ngValue]="pt.id">{{ typeLabel(pt) }}</option>
            }
          </select>
        </app-form-field>

        <app-form-field label="Name" fieldId="attribute-name" [required]="true">
          <app-translatable-input
            formControlName="name"
            label="Name"
            inputId="attribute-name"
            idPrefix="attribute-name"
            testId="attribute-name"
          ></app-translatable-input>
        </app-form-field>

        <app-form-field
          label="Code"
          fieldId="attribute-code"
          [required]="true"
          [error]="codeError()"
          hint="Lowercase letters, digits, hyphens or underscores only."
        >
          <app-input
            id="attribute-code"
            type="text"
            formControlName="code"
            [invalid]="!!codeError()"
          ></app-input>
        </app-form-field>

        <app-form-field
          label="Sort order"
          fieldId="attribute-sort-order"
          hint="Lower values appear first on the product edit form. Integers ≥ 0."
        >
          <app-input
            id="attribute-sort-order"
            type="number"
            inputmode="numeric"
            formControlName="sortOrder"
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
          data-testid="attribute-dialog-cancel"
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
          data-testid="attribute-dialog-submit"
        >
          {{ data.mode === 'create' ? 'Create' : 'Save' }}
        </app-button>
      </footer>
    </div>
  `,
})
export class AttributeDialogComponent {
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly service = inject(ProductsService);
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject<DialogRef<AttributeDialogResult>>(DialogRef);

  protected readonly typeLabel = (pt: ProductType): string =>
    productTypeLabel(pt, this.authStore.locale(), this.storeSettings.defaultLocale());

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    productTypeId: this.fb.control<string | null>(null, [Validators.required]),
    name: this.fb.nonNullable.control<{ default: string; [loc: string]: string }>({ default: '' }, [
      translatableRequired,
    ]),
    code: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(CODE_RE)]),
    sortOrder: this.fb.control<number | null>(null),
  });

  constructor(@Inject(DIALOG_DATA) public readonly data: AttributeDialogData) {
    if (data.mode === 'edit' && data.attribute) {
      this.form.patchValue({
        productTypeId: data.attribute.productTypeId,
        name: data.attribute.name,
        code: data.attribute.code,
        sortOrder: data.attribute.sortOrder ?? null,
      });
      this.form.controls.productTypeId.disable();
    } else if (data.defaultProductTypeId) {
      this.form.patchValue({ productTypeId: data.defaultProductTypeId });
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
    if (!raw.productTypeId) return;

    const body: CreateAttributeRequest = {
      productTypeId: raw.productTypeId,
      name: raw.name,
      code: raw.code.trim(),
      ...(raw.sortOrder !== null && raw.sortOrder !== undefined
        ? { sortOrder: Number(raw.sortOrder) }
        : {}),
    };

    this.busy.set(true);
    this.error.set(null);
    const request$ =
      this.data.mode === 'create'
        ? this.service.createAttribute(body)
        : this.service.updateAttribute(this.data.attribute!.id, {
            name: body.name,
            code: body.code,
            sortOrder: body.sortOrder,
          });

    request$.subscribe({
      next: (attribute) => {
        this.busy.set(false);
        this.ref.close({ kind: 'saved', attribute });
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to save attributes.';
    if (err instanceof ApiNotFoundError) return 'Attribute not found.';
    if (err instanceof ApiConflictError)
      return err.message || 'Attribute code must be unique within a product type.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save the attribute. Please retry.';
  }
}
