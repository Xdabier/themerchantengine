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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ButtonComponent,
  FormFieldComponent,
  LoadErrorComponent,
  TextareaComponent,
} from '@admin-ui';
import {
  InventoryService,
  type AdjustInventoryRequest,
  type InventoryLocation,
  type StockLevel,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import { adjustmentReasons } from './inventory.utils';

export interface AdjustDialogData {
  variantId?: string;
  locationId?: string;
  currentOnHand?: number;
  locations?: readonly InventoryLocation[];
  rows?: readonly StockLevel[];
}

@Component({
  selector: 'app-inventory-adjust-dialog',
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
        Adjust stock
      </h2>
      <p [id]="descId" class="mt-2 text-xs text-ink-muted">
        Positive adjustments add stock, negative adjustments remove it. A reason is required.
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
        <app-form-field
          label="Variant ID"
          fieldId="adjust-variant"
          [error]="requiredError('variantId', 'Variant id required.')"
        >
          <input
            id="adjust-variant"
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
            testId="adjust-locations-degraded"
            (retry)="fetchLocations()"
          />
        }

        <app-form-field
          label="Location"
          fieldId="adjust-location"
          [error]="requiredError('locationId', 'Pick a location.')"
        >
          <select
            id="adjust-location"
            name="locationId"
            formControlName="locationId"
            class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            <option value="" disabled>Select location</option>
            @for (loc of locations(); track loc.id) {
              <option [value]="loc.id">{{ loc.name }} · {{ loc.code }}</option>
            }
          </select>
        </app-form-field>

        <app-form-field label="Quantity (signed)" fieldId="adjust-quantity">
          <input
            id="adjust-quantity"
            name="quantity"
            type="number"
            step="1"
            formControlName="quantity"
            class="w-full min-h-[44px] px-3 py-2 tabular-nums text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          />
        </app-form-field>

        <app-form-field label="Reason" fieldId="adjust-reason">
          <select
            id="adjust-reason"
            name="reason"
            formControlName="reason"
            class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            @for (r of reasons; track r) {
              <option [value]="r">{{ r }}</option>
            }
          </select>
        </app-form-field>

        <app-form-field
          label="Notes"
          fieldId="adjust-notes"
          [hint]="'Optional, max 500 characters.'"
        >
          <app-textarea id="adjust-notes" formControlName="notes" [rows]="3"></app-textarea>
        </app-form-field>

        @if (error()) {
          <p
            role="alert"
            class="border border-status-error text-ink p-3 text-xs"
            data-testid="adjust-error"
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
            Apply adjustment
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class InventoryAdjustDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly inventoryService = inject(InventoryService);

  readonly titleId = `adjust-${Math.random().toString(36).slice(2, 9)}`;
  readonly descId = `${this.titleId}-desc`;
  readonly reasons = adjustmentReasons;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly locations = signal<readonly InventoryLocation[]>([]);
  readonly locationsError = signal<string | null>(null);
  readonly locationsLoading = signal(false);

  readonly form = this.fb.nonNullable.group({
    variantId: ['', [Validators.required]],
    locationId: ['', [Validators.required]],
    quantity: [0, [Validators.required]],
    reason: ['RECOUNT' as (typeof adjustmentReasons)[number], [Validators.required]],
    notes: ['', [Validators.maxLength(500)]],
  });

  constructor(
    private readonly ref: DialogRef<boolean>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: AdjustDialogData,
  ) {}

  ngOnInit(): void {
    this.locations.set(this.data?.locations ?? []);
    if (this.data?.variantId) {
      this.form.patchValue({ variantId: this.data.variantId });
    }
    if (this.data?.locationId) {
      this.form.patchValue({ locationId: this.data.locationId });
    }
    if ((this.data?.locations?.length ?? 0) === 0) {
      this.fetchLocations();
    }
  }

  /** Without locations the form cannot be submitted at all, so say so. */
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
    const payload: AdjustInventoryRequest = {
      variantId: value.variantId,
      locationId: value.locationId,
      quantity: Number(value.quantity),
      reason: value.reason,
      ...(value.notes ? { notes: value.notes } : {}),
    };
    this.inventoryService.adjustInventory(payload).subscribe({
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

  requiredError(name: 'variantId' | 'locationId', message: string): string | null {
    const ctrl = this.form.controls[name];
    if (!ctrl.touched || ctrl.valid) return null;
    return ctrl.hasError('required') ? message : null;
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to adjust stock.';
    if (err instanceof ApiNotFoundError) return 'Inventory record not found.';
    if (err instanceof ApiValidationError)
      return err.message || 'Adjustment rejected by the server.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save adjustment. Please retry.';
  }
}

export async function openAdjustDialog(
  dialog: Dialog,
  data: AdjustDialogData = {},
): Promise<boolean> {
  const ref = dialog.open<boolean>(InventoryAdjustDialogComponent, {
    data,
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    role: 'dialog',
    ariaModal: true,
    ariaLabel: 'Adjust stock',
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
