import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
  Optional,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent } from '@admin-ui';
import {
  InventoryService,
  type CreateLocationRequest,
  type InventoryLocation,
  type UpdateLocationRequest,
} from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';

export interface LocationDialogData {
  location?: InventoryLocation;
}

@Component({
  selector: 'app-inventory-location-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, FormFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full max-w-md bg-surface border border-line p-6">
      <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
        {{ isEdit() ? 'Edit location' : 'New inventory location' }}
      </h2>
      <p [id]="descId" class="mt-2 text-xs text-ink-muted">
        Name your warehouse or store. Codes are uppercase identifiers used in movement logs.
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
        <app-form-field label="Name" fieldId="location-name" [error]="nameError()">
          <input
            id="location-name"
            name="name"
            formControlName="name"
            class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          />
        </app-form-field>

        <app-form-field
          label="Code"
          fieldId="location-code"
          [error]="codeError()"
          [hint]="'Uppercase letters, digits, hyphens or underscores. Max 20 chars.'"
        >
          <input
            id="location-code"
            name="code"
            formControlName="code"
            class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          />
        </app-form-field>

        <label class="flex items-center gap-2 min-h-[44px] text-sm tabular text-ink">
          <input type="checkbox" formControlName="isActive" class="h-4 w-4" />
          Active
        </label>

        @if (error()) {
          <p
            role="alert"
            class="border border-status-error text-ink p-3 text-xs"
            data-testid="location-error"
          >
            {{ error() }}
          </p>
        }

        <div class="flex items-center justify-end gap-3 pt-2">
          <app-button variant="ghost" type="button" (clicked)="close()">Cancel</app-button>
          <app-button
            type="submit"
            variant="primary"
            [disabled]="form.invalid || busy()"
            [loading]="busy()"
          >
            {{ isEdit() ? 'Save' : 'Create' }}
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class InventoryLocationDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly inventoryService = inject(InventoryService);

  readonly titleId = `loc-${Math.random().toString(36).slice(2, 9)}`;
  readonly descId = `${this.titleId}-desc`;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9_-]{1,20}$/)]],
    isActive: [true],
  });

  readonly isEdit = computed(() => !!this.data?.location);

  constructor(
    private readonly ref: DialogRef<InventoryLocation | null>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: LocationDialogData,
  ) {}

  ngOnInit(): void {
    if (this.data?.location) {
      this.form.patchValue({
        name: this.data.location.name,
        code: this.data.location.code,
        isActive: this.data.location.isActive ?? true,
      });
      this.form.controls.code.disable();
    }
  }

  nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Name is required.';
    if (c.hasError('maxlength')) return 'Name must be 100 characters or fewer.';
    return null;
  }

  codeError(): string | null {
    const c = this.form.controls.code;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Code is required.';
    if (c.hasError('pattern')) return 'Use uppercase letters, digits, hyphens or underscores.';
    return null;
  }

  submit(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const value = this.form.getRawValue();

    if (this.data?.location) {
      const payload: UpdateLocationRequest = {
        name: value.name,
        isActive: value.isActive,
      };
      this.inventoryService.updateLocation(this.data.location.id, payload).subscribe({
        next: (loc) => this.ref.close(loc),
        error: (err: unknown) => {
          this.busy.set(false);
          this.error.set(this.formatError(err));
        },
      });
      return;
    }

    const payload: CreateLocationRequest = {
      name: value.name,
      code: value.code,
      isActive: value.isActive,
    };
    this.inventoryService.createLocation(payload).subscribe({
      next: (loc) => this.ref.close(loc),
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  close(): void {
    this.ref.close(null);
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiConflictError) return 'A location with this code already exists.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage locations.';
    if (err instanceof ApiNotFoundError) return 'Location not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save location. Please retry.';
  }
}

export async function openLocationDialog(
  dialog: Dialog,
  data: LocationDialogData = {},
): Promise<InventoryLocation | null> {
  const ref = dialog.open<InventoryLocation | null>(InventoryLocationDialogComponent, {
    data,
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    role: 'dialog',
    ariaModal: true,
    ariaLabel: data.location ? 'Edit location' : 'New inventory location',
    hasBackdrop: true,
    autoFocus: 'first-tabbable',
  });
  return await new Promise<InventoryLocation | null>((resolve) => {
    const sub = ref.closed.subscribe((value) => {
      resolve(value ?? null);
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}
