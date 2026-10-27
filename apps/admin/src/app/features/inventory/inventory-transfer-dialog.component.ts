import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
  Optional,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import {
  ButtonComponent,
  FormFieldComponent,
  LoadErrorComponent,
  TextareaComponent,
} from '@admin-ui';
import {
  InventoryService,
  type InventoryLocation,
  type TransferInventoryRequest,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';

export interface TransferDialogData {
  variantId?: string;
  fromLocationId?: string;
  locations?: readonly InventoryLocation[];
}

function sameLocationValidator(control: AbstractControl): ValidationErrors | null {
  const from = control.get('fromLocationId')?.value;
  const to = control.get('toLocationId')?.value;
  return from && to && from === to ? { sameLocation: true } : null;
}

@Component({
  selector: 'app-inventory-transfer-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    LoadErrorComponent,
    TextareaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full max-w-lg bg-surface border border-line p-6">
      <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
        Transfer stock
      </h2>
      <p [id]="descId" class="mt-2 text-xs text-ink-muted">
        Moves a positive quantity from one location to another. Atomic on the server.
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
        <app-form-field
          label="Variant ID"
          fieldId="transfer-variant"
          [error]="requiredError('variantId', 'Variant id required.')"
        >
          <input
            id="transfer-variant"
            name="variantId"
            formControlName="variantId"
            class="w-full min-h-[44px] px-3 py-2 tabular-nums text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          />
        </app-form-field>

        @if (locationsError()) {
          <app-load-error
            [message]="locationsError()!"
            [compact]="true"
            [retrying]="locationsLoading()"
            retryLabel="locations"
            testId="transfer-locations-degraded"
            (retry)="fetchLocations()"
          />
        }

        <app-form-field
          label="From location"
          fieldId="transfer-from"
          [error]="requiredError('fromLocationId', 'Pick a source.')"
        >
          <select
            id="transfer-from"
            name="fromLocationId"
            formControlName="fromLocationId"
            class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            <option value="" disabled>Select source</option>
            @for (loc of locations(); track loc.id) {
              <option [value]="loc.id">{{ loc.name }} · {{ loc.code }}</option>
            }
          </select>
        </app-form-field>

        <app-form-field
          label="To location"
          fieldId="transfer-to"
          [error]="sameLocationError() ? 'Source and destination must differ.' : null"
        >
          <select
            id="transfer-to"
            name="toLocationId"
            formControlName="toLocationId"
            class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            <option value="" disabled>Select destination</option>
            @for (loc of locations(); track loc.id) {
              <option [value]="loc.id">{{ loc.name }} · {{ loc.code }}</option>
            }
          </select>
        </app-form-field>

        <app-form-field label="Quantity" fieldId="transfer-quantity">
          <input
            id="transfer-quantity"
            name="quantity"
            type="number"
            min="1"
            step="1"
            formControlName="quantity"
            class="w-full min-h-[44px] px-3 py-2 tabular-nums text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          />
        </app-form-field>

        <app-form-field
          label="Notes"
          fieldId="transfer-notes"
          [hint]="'Optional, max 500 characters.'"
        >
          <app-textarea id="transfer-notes" formControlName="notes" [rows]="3"></app-textarea>
        </app-form-field>

        @if (error()) {
          <p
            role="alert"
            class="border border-status-error text-ink p-3 text-xs"
            data-testid="transfer-error"
          >
            {{ error() }}
          </p>
        }

        <div class="flex items-center justify-end gap-3 pt-2">
          <app-button variant="ghost" type="button" (clicked)="close(false)">Cancel</app-button>
          <app-button
            type="submit"
            variant="primary"
            [disabled]="form.invalid || busy()"
            [loading]="busy()"
          >
            Transfer stock
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class InventoryTransferDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly inventoryService = inject(InventoryService);

  readonly titleId = `transfer-${Math.random().toString(36).slice(2, 9)}`;
  readonly descId = `${this.titleId}-desc`;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly locations = signal<readonly InventoryLocation[]>([]);
  readonly locationsError = signal<string | null>(null);
  readonly locationsLoading = signal(false);

  readonly form = this.fb.nonNullable.group(
    {
      variantId: ['', [Validators.required]],
      fromLocationId: ['', [Validators.required]],
      toLocationId: ['', [Validators.required]],
      quantity: [1, [Validators.required, Validators.min(1)]],
      notes: ['', [Validators.maxLength(500)]],
    },
    { validators: [sameLocationValidator] },
  );

  // Plain method, not computed(): the cross-field group error reads form.errors
  // (a Reactive-Forms getter behind untracked()), so a computed() would freeze at
  // its initial value and the same-location warning would never toggle under
  // zoneless CD. A method re-evaluates each CD pass the select (change) schedules.
  sameLocationError(): boolean {
    return !!this.form.errors?.['sameLocation'];
  }

  constructor(
    private readonly ref: DialogRef<boolean>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: TransferDialogData,
  ) {}

  ngOnInit(): void {
    this.locations.set(this.data?.locations ?? []);
    if (this.data?.variantId) this.form.patchValue({ variantId: this.data.variantId });
    if (this.data?.fromLocationId)
      this.form.patchValue({ fromLocationId: this.data.fromLocationId });
    if ((this.data?.locations?.length ?? 0) === 0) {
      this.fetchLocations();
    }
  }

  /** Both selects are empty without this list, so a failure has to be visible. */
  fetchLocations(): void {
    this.locationsLoading.set(true);
    this.inventoryService.listLocations({ page: 1, pageSize: 100 }).subscribe({
      next: (res) => {
        this.locations.set(res.data);
        this.locationsError.set(null);
        this.locationsLoading.set(false);
      },
      error: () => {
        this.locations.set([]);
        this.locationsError.set('Could not load locations.');
        this.locationsLoading.set(false);
      },
    });
  }

  submit(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const value = this.form.getRawValue();
    const payload: TransferInventoryRequest = {
      variantId: value.variantId,
      fromLocationId: value.fromLocationId,
      toLocationId: value.toLocationId,
      quantity: Number(value.quantity),
      ...(value.notes ? { notes: value.notes } : {}),
    };
    this.inventoryService.transferInventory(payload).subscribe({
      next: () => this.close(true),
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  close(saved: boolean): void {
    this.ref.close(saved);
  }

  requiredError(
    name: 'variantId' | 'fromLocationId' | 'toLocationId',
    message: string,
  ): string | null {
    const ctrl = this.form.controls[name];
    if (!ctrl.touched || ctrl.valid) return null;
    return ctrl.hasError('required') ? message : null;
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to transfer stock.';
    if (err instanceof ApiNotFoundError) return 'Location not found.';
    if (err instanceof ApiValidationError) return err.message || 'Transfer rejected by the server.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not complete transfer. Please retry.';
  }
}

export async function openTransferDialog(
  dialog: Dialog,
  data: TransferDialogData = {},
): Promise<boolean> {
  const ref = dialog.open<boolean>(InventoryTransferDialogComponent, {
    data,
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    role: 'dialog',
    ariaModal: true,
    ariaLabel: 'Transfer stock',
    hasBackdrop: true,
    autoFocus: 'first-tabbable',
  });
  return await new Promise<boolean>((resolve) => {
    const sub = ref.closed.subscribe((value) => {
      resolve(Boolean(value));
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}
