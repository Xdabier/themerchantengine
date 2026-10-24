import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Inject, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TranslatableInputComponent,
} from '@admin-ui';
import { ProductsService, type Attribute, type CreateAttributeValueRequest } from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { pickTranslation, type Translatable } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

export interface AttributeValuesDialogData {
  attribute: Attribute;
  canMutate: boolean;
}

export type AttributeValuesDialogResult = { kind: 'changed' } | null;

type AttributeValue = NonNullable<Attribute['values']>[number];

const CODE_RE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

function attributeLabel(
  a: Pick<Attribute, 'name' | 'code'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    a.name as Translatable | string | null | undefined,
    locale,
    a.code,
    defaultLocale,
  );
}

function valueLabel(v: AttributeValue, locale: string, defaultLocale: string): string {
  return pickTranslation(
    v.value as Translatable | string | null | undefined,
    locale,
    v.code,
    defaultLocale,
  );
}

@Component({
  selector: 'app-attribute-values-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full max-w-lg h-screen bg-surface border-l border-line flex flex-col"
      data-testid="attribute-values-dialog"
    >
      <header class="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2
            id="attribute-values-dialog-title"
            class="text-lg md:text-xl font-bold tracking-tight text-ink"
          >
            Values for “{{ attributeLabel(data.attribute) }}”
          </h2>
          <p class="mt-1 text-xs tabular text-ink-muted">
            Ordered by sort value. Delete is blocked (409) when variants are using a value.
          </p>
        </div>
        <button
          type="button"
          class="text-xs tracking-widest uppercase text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 px-1"
          aria-label="Close attribute values dialog"
          (click)="close()"
          data-testid="attribute-values-dialog-close"
        >
          Close
        </button>
      </header>

      <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
        <div role="status" aria-live="polite" data-testid="attribute-values-error">
          @if (error()) {
            <p class="border border-status-error text-ink p-3 tabular text-xs">
              {{ error() }}
            </p>
          }
        </div>

        <section class="flex flex-col gap-3" aria-label="Existing values">
          @if (loading()) {
            <app-skeleton height="2.5rem" />
            <app-skeleton height="2.5rem" />
          } @else if (values().length === 0) {
            <p class="text-xs tabular text-ink-muted" data-testid="attribute-values-empty">
              No values yet. Add one below.
            </p>
          } @else {
            @for (v of values(); track v.id) {
              <div
                class="border border-line p-3 flex items-center justify-between gap-3"
                [attr.data-testid]="'attribute-value-row-' + v.id"
              >
                <div class="min-w-0">
                  <p class="tabular text-sm text-ink truncate">{{ valueLabel(v) }}</p>
                  <p class="tabular text-xs text-ink-muted">
                    {{ v.code }} · sort {{ v.sortOrder ?? 0 }}
                  </p>
                </div>
                @if (data.canMutate) {
                  <app-button
                    type="button"
                    variant="ghost"
                    size="sm"
                    (clicked)="deleteValue(v)"
                    [attr.data-testid]="'attribute-value-delete-' + v.id"
                  >
                    Delete
                  </app-button>
                }
              </div>
            }
          }
        </section>

        @if (data.canMutate) {
          <section class="flex flex-col gap-4 border-t border-line pt-5">
            <h3 class="text-xs tracking-widest uppercase text-ink-muted">Add a new value</h3>
            <form [formGroup]="form" class="flex flex-col gap-4" novalidate>
              <app-form-field label="Value" fieldId="attribute-value-value" [required]="true">
                <app-translatable-input
                  formControlName="value"
                  label="Value"
                  inputId="attribute-value-value"
                  idPrefix="attribute-value-value"
                  testId="attribute-value-value"
                ></app-translatable-input>
              </app-form-field>

              <app-form-field
                label="Code"
                fieldId="attribute-value-code"
                [required]="true"
                [error]="codeError()"
                hint="Lowercase letters, digits, hyphens or underscores only."
              >
                <app-input
                  id="attribute-value-code"
                  type="text"
                  formControlName="code"
                  [invalid]="!!codeError()"
                ></app-input>
              </app-form-field>

              <app-form-field
                label="Sort order"
                fieldId="attribute-value-sort-order"
                hint="Integers ≥ 0. Lower values appear first."
              >
                <app-input
                  id="attribute-value-sort-order"
                  type="number"
                  inputmode="numeric"
                  formControlName="sortOrder"
                ></app-input>
              </app-form-field>

              <div class="flex items-center justify-end">
                <app-button
                  type="button"
                  variant="primary"
                  size="md"
                  [disabled]="form.invalid || busy()"
                  [loading]="busy()"
                  (clicked)="addValue()"
                  data-testid="attribute-values-add"
                >
                  Add value
                </app-button>
              </div>
            </form>
          </section>
        }
      </div>
    </div>
  `,
})
export class AttributeValuesDialogComponent {
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly service = inject(ProductsService);
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject<DialogRef<AttributeValuesDialogResult>>(DialogRef);

  protected readonly attributeLabel = (a: Pick<Attribute, 'name' | 'code'>): string =>
    attributeLabel(a, this.authStore.locale(), this.storeSettings.defaultLocale());
  protected readonly valueLabel = (v: AttributeValue): string =>
    valueLabel(v, this.authStore.locale(), this.storeSettings.defaultLocale());

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly values = signal<readonly AttributeValue[]>([]);
  private changed = false;

  readonly form = this.fb.nonNullable.group({
    value: this.fb.nonNullable.control<{ default: string; [loc: string]: string }>(
      { default: '' },
      [translatableRequired],
    ),
    code: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(CODE_RE)]),
    sortOrder: this.fb.control<number | null>(null),
  });

  constructor(@Inject(DIALOG_DATA) public readonly data: AttributeValuesDialogData) {
    const initial = [...(data.attribute.values ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    this.values.set(initial);
  }

  codeError(): string | null {
    const c = this.form.controls.code;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Code is required.';
    if (c.hasError('pattern'))
      return 'Code must be lowercase letters, digits, hyphens or underscores.';
    return null;
  }

  addValue(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;

    const raw = this.form.getRawValue();
    const body: CreateAttributeValueRequest = {
      value: raw.value,
      code: raw.code.trim(),
      ...(raw.sortOrder !== null && raw.sortOrder !== undefined
        ? { sortOrder: Number(raw.sortOrder) }
        : {}),
    };

    this.busy.set(true);
    this.error.set(null);
    this.service.createAttributeValue(this.data.attribute.id, body).subscribe({
      next: (next) => {
        this.busy.set(false);
        this.values.set(
          [...(next.values ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
        );
        this.changed = true;
        this.form.reset({ value: { default: '' }, code: '', sortOrder: null });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  deleteValue(v: AttributeValue): void {
    this.error.set(null);
    this.service.deleteAttributeValue(this.data.attribute.id, v.id).subscribe({
      next: () => {
        this.values.update((list) => list.filter((x) => x.id !== v.id));
        this.changed = true;
      },
      error: (err: unknown) => this.error.set(this.formatError(err)),
    });
  }

  close(): void {
    this.ref.close(this.changed ? { kind: 'changed' } : null);
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to modify attribute values.';
    if (err instanceof ApiNotFoundError) return 'Attribute value not found.';
    if (err instanceof ApiConflictError)
      return err.message || 'Variants use this value. Delete blocked.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not update the attribute values. Please retry.';
  }
}
