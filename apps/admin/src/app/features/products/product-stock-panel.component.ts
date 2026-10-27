import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormRecord,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent } from '@admin-ui';
import {
  InventoryService,
  ProductsService,
  type AdjustmentReason,
  type ProductStock,
} from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError } from '@admin-types';
import { adjustmentReasons } from '../inventory/inventory.utils';

export interface StockPanelData {
  productId: string;
  variantId: string;
  sku: string;
}

/** One editable line: a location, what is there now, and the target. */
interface StockLine {
  locationId: string;
  locationLabel: string;
  isActive: boolean;
  hasRow: boolean;
  onHand: number;
  reserved: number;
  available: number;
}

/**
 * Set stock for one variant, per location, from the product pages.
 *
 * Writes with the SET mode rather than a delta the client computes. Two
 * operators both reading 20 and both setting 25 would each send +5 and land at
 * 30; sending the target with the value they saw makes the second one a refusal
 * instead of a silent overwrite.
 *
 * Reuses the inventory Adjust endpoint rather than the existing Adjust dialog:
 * that dialog is delta-only, exposes a free-text variant id (a correctness
 * hazard inside a product page, where it would let an operator adjust another
 * product's stock), never shows what is currently there, and handles one
 * location at a time with no notion of a variant that has no row yet.
 */
@Component({
  selector: 'app-product-stock-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, FormFieldComponent],
  template: `
    <section
      class="bg-surface border border-line p-6 flex flex-col gap-5 w-[min(38rem,92vw)]"
      data-testid="product-stock-panel"
    >
      <header class="flex items-start justify-between gap-4">
        <div>
          <h2 id="stock-panel-title" class="text-xl font-bold tracking-tight">Stock</h2>
          <p class="mt-1 tabular text-sm text-ink-muted">{{ data.sku }}</p>
        </div>
        <app-button
          type="button"
          variant="secondary"
          size="sm"
          (clicked)="close()"
          testId="product-stock-close"
        >
          Close
        </app-button>
      </header>

      @if (error()) {
        <p
          class="border border-status-error text-ink p-3 tabular text-xs"
          role="alert"
          data-testid="product-stock-error"
        >
          {{ error() }}
        </p>
      }

      @if (loading()) {
        <p class="tabular text-sm text-ink-muted">Loading stock…</p>
      } @else if (lines().length === 0) {
        <div class="border border-line p-4 flex flex-col gap-3" role="alert">
          <p class="tabular text-sm text-ink" data-testid="product-stock-no-locations">
            No inventory location exists, so stock cannot be recorded anywhere yet.
          </p>
          <a
            routerLink="/inventory/locations"
            class="text-xs tabular text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            Manage locations
          </a>
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-5" novalidate>
          @for (line of lines(); track line.locationId) {
            <div
              class="border border-line p-4 flex flex-col gap-3"
              [attr.data-testid]="'product-stock-line-' + line.locationId"
            >
              @if (lines().length > 1) {
                <p class="text-xs tracking-widest uppercase text-ink-muted">
                  {{ line.locationLabel }}
                </p>
              }
              <dl class="grid grid-cols-3 gap-3">
                <div>
                  <dt class="text-xs tracking-widest uppercase text-ink-muted">On hand</dt>
                  <dd class="mt-1 tabular-nums text-sm text-ink">{{ line.onHand }}</dd>
                </div>
                <div>
                  <dt class="text-xs tracking-widest uppercase text-ink-muted">Reserved</dt>
                  <dd class="mt-1 tabular-nums text-sm text-ink-muted">{{ line.reserved }}</dd>
                </div>
                <div>
                  <dt class="text-xs tracking-widest uppercase text-ink-muted">Available</dt>
                  <dd class="mt-1 tabular-nums text-sm text-ink">{{ line.available }}</dd>
                </div>
              </dl>
              <app-form-field
                [label]="'Set on hand to'"
                [fieldId]="'stock-target-' + line.locationId"
              >
                <input
                  type="number"
                  min="0"
                  step="1"
                  [id]="'stock-target-' + line.locationId"
                  [formControl]="targetControl(line.locationId)"
                  [attr.data-testid]="'product-stock-target-' + line.locationId"
                  class="min-h-[44px] w-full px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                />
              </app-form-field>
              @if (!line.hasRow) {
                <p class="text-xs tabular text-ink-muted">
                  No stock recorded here yet. Saving creates the first record.
                </p>
              }
            </div>
          }

          <app-form-field label="Reason" fieldId="stock-reason">
            <select
              id="stock-reason"
              [formControl]="reason"
              data-testid="product-stock-reason"
              class="min-h-[44px] w-full px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              @for (r of reasons; track r) {
                <option [value]="r">{{ r }}</option>
              }
            </select>
          </app-form-field>

          <div class="flex items-center justify-end gap-2">
            <app-button
              type="submit"
              variant="primary"
              size="sm"
              [disabled]="busy() || !targets.dirty"
              [loading]="busy()"
              testId="product-stock-save"
            >
              {{ busy() ? 'Saving…' : 'Save stock' }}
            </app-button>
          </div>
        </form>
      }

      <p class="sr-only" role="status" aria-live="polite" data-testid="product-stock-status">
        {{ announcement() }}
      </p>
    </section>
  `,
})
export class ProductStockPanelComponent {
  private readonly products = inject(ProductsService);
  private readonly inventory = inject(InventoryService);
  private readonly ref = inject<DialogRef<boolean>>(DialogRef);

  protected readonly reasons: readonly AdjustmentReason[] = adjustmentReasons;
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly announcement = signal('');

  private readonly stock = signal<ProductStock | null>(null);

  /**
   * Dynamic keys, one per location, so a typed FormGroup cannot express it.
   * `FormRecord` is the shape Angular provides for exactly this.
   */
  protected readonly targets = new FormRecord<FormControl<number>>({});
  protected readonly reason = new FormControl<AdjustmentReason>('RECOUNT', { nonNullable: true });
  /**
   * Wrapper so the form carries a directive. `(ngSubmit)` is an output of
   * `FormGroupDirective`, not of the native element, so a bare `<form>` with
   * `(ngSubmit)` silently never fires.
   */
  protected readonly form = new FormGroup({ targets: this.targets, reason: this.reason });

  /**
   * One line per ACTIVE location, plus any inactive location that still holds a
   * row. An inactive location with stock has to stay visible, otherwise those
   * units simply vanish from the screen; an inactive one with no row is not
   * somewhere new stock should be invited.
   */
  protected readonly lines = computed<StockLine[]>(() => {
    const snapshot = this.stock();
    if (!snapshot) return [];
    const variant = snapshot.variants.find((v) => v.variantId === this.data.variantId);
    const byLocation = new Map(variant?.levels.map((l) => [l.locationId, l]) ?? []);

    const active = snapshot.locations.map((loc) => {
      const level = byLocation.get(loc.id);
      return {
        locationId: loc.id,
        locationLabel: `${loc.name} · ${loc.code}`,
        isActive: true,
        hasRow: !!level,
        onHand: level?.onHand ?? 0,
        reserved: level?.reserved ?? 0,
        available: level?.available ?? 0,
      };
    });
    const activeIds = new Set(active.map((l) => l.locationId));
    const strandedInactive = (variant?.levels ?? [])
      .filter((l) => !activeIds.has(l.locationId))
      .map((l) => ({
        locationId: l.locationId,
        locationLabel: `${l.location.name} · ${l.location.code} (inactive)`,
        isActive: false,
        hasRow: true,
        onHand: l.onHand,
        reserved: l.reserved,
        available: l.available,
      }));
    return [...active, ...strandedInactive];
  });

  constructor(@Inject(DIALOG_DATA) public readonly data: StockPanelData) {
    this.load();
  }

  protected close(): void {
    this.ref.close(false);
  }

  private load(): void {
    this.loading.set(true);
    this.products.getProductStock(this.data.productId).subscribe({
      next: (stock) => {
        this.stock.set(stock);
        this.seedControls();
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(this.format(err, 'Could not load stock.'));
      },
    });
  }

  /** One control per line, seeded with what is currently there. */
  private seedControls(): void {
    for (const line of this.lines()) {
      const existing = this.targets.get(line.locationId);
      if (existing) existing.setValue(line.onHand, { emitEvent: false });
      else
        this.targets.addControl(
          line.locationId,
          new FormControl<number>(line.onHand, {
            nonNullable: true,
            validators: [Validators.required, Validators.min(0)],
          }),
        );
    }
    this.targets.markAsPristine();
  }

  protected targetControl(locationId: string): FormControl<number> {
    return this.targets.get(locationId) as FormControl<number>;
  }

  /**
   * Save every line whose target changed.
   *
   * Each line carries its own idempotency key, minted once per intent and
   * reused if the same intent is retried. A key minted per call would make a
   * double-click two distinct requests to the server, which is precisely the
   * defect this screen would otherwise inherit.
   */
  protected save(): void {
    if (this.busy() || this.targets.invalid) return;
    const changed = this.lines().filter((line) => {
      const control = this.targets.get(line.locationId);
      return control?.dirty && Number(control.value) !== line.onHand;
    });
    if (changed.length === 0) return;

    const reason = this.reason.value;
    this.busy.set(true);
    this.error.set(null);

    let remaining = changed.length;
    let failed = false;

    for (const line of changed) {
      const target = Number(this.targets.get(line.locationId)!.value);
      const key = this.keyFor(line.locationId, target, line.onHand);
      this.inventory
        .adjustInventory(
          {
            variantId: this.data.variantId,
            locationId: line.locationId,
            setTo: target,
            // The compare half: the value this screen showed the operator.
            expectedOnHand: line.onHand,
            reason,
          },
          key,
        )
        .subscribe({
          next: () => {
            remaining -= 1;
            if (remaining === 0 && !failed) this.finish();
          },
          error: (err: unknown) => {
            failed = true;
            remaining -= 1;
            this.busy.set(false);
            this.error.set(this.format(err, 'Could not save stock.'));
            // Re-read so the fields show what is actually there, which is the
            // only way the operator can retype against a moved value.
            this.load();
          },
        });
    }
  }

  private finish(): void {
    this.busy.set(false);
    this.announcement.set('Stock saved.');
    this.ref.close(true);
  }

  /** Stable per intent: same location, same target, same starting point. */
  private keyFor(locationId: string, target: number, from: number): string {
    const cached = this.keys.get(`${locationId}:${from}:${target}`);
    if (cached) return cached;
    const key = crypto.randomUUID();
    this.keys.set(`${locationId}:${from}:${target}`, key);
    return key;
  }

  private readonly keys = new Map<string, string>();

  private format(err: unknown, fallback: string): string {
    if (err instanceof ApiConflictError) {
      const current = (err.details as { currentOnHand?: number } | null)?.currentOnHand;
      return current === undefined
        ? 'Stock changed since this panel was opened. The numbers below have been refreshed.'
        : `Stock changed since this panel was opened; it is now ${current}. The numbers below have been refreshed.`;
    }
    if (err instanceof ApiError && err.code === 'INVENTORY_SET_BELOW_RESERVED') {
      return 'That target is below the quantity already reserved for orders.';
    }
    if (err instanceof ApiForbiddenError) {
      return 'You do not have permission to change stock.';
    }
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}

/** Open the panel. Resolves true when stock was saved. */
export async function openStockPanel(dialog: Dialog, data: StockPanelData): Promise<boolean> {
  const ref = dialog.open<boolean>(ProductStockPanelComponent, {
    data,
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    role: 'dialog',
    ariaModal: true,
    ariaLabelledBy: 'stock-panel-title',
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
