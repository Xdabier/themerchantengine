import { CommonModule } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Inject,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@admin-ui';
import { ProductsService, productStatusSchema, type ProductStatus } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';

export const BULK_STATUS_DIALOG_TITLE_ID = 'bulk-status-dialog-title';

export interface BulkStatusDialogData {
  readonly productIds: readonly string[];
}

export interface BulkStatusDialogResult {
  readonly status: ProductStatus;
  readonly count: number;
}

const STATUS_OPTIONS: ReadonlyArray<{
  value: ProductStatus;
  label: string;
  description: string;
}> = [
  { value: 'DRAFT', label: 'Draft', description: 'Hides the product from storefront.' },
  { value: 'ACTIVE', label: 'Active', description: 'Publishes the product to storefront.' },
  {
    value: 'ARCHIVED',
    label: 'Archived',
    description: 'Hides and marks for future cleanup.',
  },
];

@Component({
  selector: 'app-bulk-status-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      [formGroup]="form"
      (ngSubmit)="submit()"
      class="w-full max-w-lg bg-surface border border-line p-6 flex flex-col gap-6"
      data-testid="bulk-status-dialog"
    >
      <header class="flex flex-col gap-2">
        <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
          Change status for {{ data.productIds.length }}
          {{ data.productIds.length === 1 ? 'product' : 'products' }}
        </h2>
        <p class="text-sm text-ink-muted">
          The selected products move to the chosen status. Storefront visibility updates
          immediately.
        </p>
      </header>

      <fieldset class="flex flex-col gap-3">
        <legend class="sr-only">Product status</legend>
        @for (opt of statusOptions; track opt.value) {
          <label
            class="flex items-start gap-3 p-3 border cursor-pointer min-h-[44px]"
            [class.border-ink]="form.controls.status.value === opt.value"
            [class.border-line]="form.controls.status.value !== opt.value"
          >
            <input
              type="radio"
              class="mt-1 appearance-none w-4 h-4 border border-line-strong bg-surface checked:bg-surface-emphasis checked:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [value]="opt.value"
              [formControl]="form.controls.status"
              [attr.data-testid]="'bulk-status-option-' + opt.value"
            />
            <span class="flex flex-col gap-1">
              <span class="text-sm text-ink font-medium">{{ opt.label }}</span>
              <span class="text-xs text-ink-muted">{{ opt.description }}</span>
            </span>
          </label>
        }
      </fieldset>

      <p
        class="text-xs border p-3 min-h-[2.5rem]"
        [class.border-status-error]="!!errorMessage()"
        [class.border-transparent]="!errorMessage()"
        [class.text-ink]="!!errorMessage()"
        [class.text-ink-muted]="!errorMessage()"
        role="alert"
        data-testid="bulk-status-error"
      >
        {{ errorMessage() || ' ' }}
      </p>

      <div class="flex items-center justify-end gap-3">
        <app-button
          variant="ghost"
          type="button"
          (clicked)="cancel()"
          data-testid="bulk-status-cancel"
        >
          Cancel
        </app-button>
        <app-button
          variant="primary"
          type="submit"
          [disabled]="form.invalid || submitting()"
          data-testid="bulk-status-submit"
        >
          {{ submitting() ? 'Applying…' : 'Apply' }}
        </app-button>
      </div>
    </form>
  `,
})
export class BulkStatusDialogComponent {
  private readonly dialogRef = inject<DialogRef<BulkStatusDialogResult | null>>(DialogRef);
  private readonly products = inject(ProductsService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly titleId = BULK_STATUS_DIALOG_TITLE_ID;
  readonly statusOptions = STATUS_OPTIONS;

  readonly form = new FormGroup({
    status: new FormControl<ProductStatus | null>(null, { validators: [Validators.required] }),
  });

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor(@Inject(DIALOG_DATA) public readonly data: BulkStatusDialogData) {}

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }
    const raw = this.form.controls.status.value;
    const parsed = productStatusSchema.safeParse(raw);
    if (!parsed.success) return;
    const status = parsed.data;
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.products
      .bulkUpdateStatus({
        productIds: [...this.data.productIds] as [string, ...string[]],
        status,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.dialogRef.close({ status, count: this.data.productIds.length });
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
      const firstRadio =
        this.host.nativeElement.querySelector<HTMLInputElement>('input[type="radio"]');
      firstRadio?.focus();
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to change product status.';
    if (err instanceof ApiNotFoundError) return 'Product not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not apply status change. Please retry.';
  }
}
