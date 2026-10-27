import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormArray,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { BadgeComponent, ButtonComponent, FormFieldComponent } from '@admin-ui';
import {
  OrdersService,
  writableShipmentStatusSchema,
  type CreateShipmentRequest,
  type Order,
  type ShipmentStatus,
  type WritableShipmentStatus,
  type UpdateShipmentRequest,
} from '@admin-services';
import {
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  pickTranslation,
  type Translatable,
} from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { orderStatusLabel, shipmentStatusLabel } from './orders.utils';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

type OrderItem = {
  id: string;
  /** Reduced product name (plus variant label), or the SKU / id when absent. */
  name: string;
  sku?: string;
  quantity: number;
};

type ShipmentRow = {
  id: string;
  /** Positional operator label ("Shipment 1"); the Shipment model has no number column. */
  label: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: ShipmentStatus | string;
};

/**
 * Create + update shipments for a single order. Permission-gated by
 * `orders:update` upstream. Backed by POST /shipments and PATCH /shipments/:sid.
 */
@Component({
  selector: 'app-order-shipment-panel',
  standalone: true,
  imports: [ReactiveFormsModule, BadgeComponent, ButtonComponent, FormFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="border border-line bg-surface"
      data-testid="order-shipment-panel"
      aria-labelledby="order-shipment-heading"
    >
      <header class="px-5 py-4 border-b border-line flex items-center justify-between">
        <h2 id="order-shipment-heading" class="text-xs tracking-widest uppercase text-ink-muted">
          Shipments
        </h2>
        <span role="status" aria-live="polite" aria-atomic="true">
          @if (saved()) {
            <app-badge tone="success" ariaLabel="Shipment saved">Saved</app-badge>
          }
        </span>
      </header>

      <div class="p-5 flex flex-col gap-6">
        @if (error()) {
          <p
            role="alert"
            class="border border-status-error text-ink p-3 tabular text-xs"
            data-testid="shipment-error"
          >
            {{ error() }}
          </p>
        }

        @if (closed()) {
          <p
            class="border border-line text-ink-muted p-3 tabular text-xs"
            data-testid="shipment-closed-notice"
          >
            This order is {{ orderStatusLabel(order().status) }}. Shipments are frozen: the API
            refuses every shipment write on a closed order.
          </p>
        }

        @if (existing().length > 0) {
          <ul class="flex flex-col divide-y divide-line" data-testid="shipment-list">
            @for (s of existing(); track s.id) {
              <li class="py-3 flex items-center gap-3 flex-wrap">
                <span class="tabular-nums text-sm text-ink" [attr.title]="s.id">
                  {{ s.label }}
                </span>
                <app-badge tone="neutral">{{ shipmentStatusLabel(s.status) }}</app-badge>
                <span class="text-xs text-ink-muted tabular">
                  {{ s.carrier ?? '—' }} · {{ s.trackingNumber ?? 'no tracking' }}
                </span>
                <!-- No control on a frozen row. A closed order refuses every
                     shipment write, and a CANCELLED shipment is terminal even
                     while its order lives on, so the select would only produce
                     a 409 for the operator to read (finding AD4). -->
                @if (!closed() && s.status !== 'CANCELLED') {
                  <div class="ml-auto flex items-center gap-2">
                    <!-- Per-option selected, not a value binding on the select:
                         the value binding is applied before the options exist,
                         so the browser fell back to the first one and every row
                         read PROCESSING regardless of its real status. -->
                    <select
                      class="min-h-[44px] px-2 text-xs tabular bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      (change)="advanceShipment(s, $event)"
                      [attr.aria-label]="'Update ' + s.label + ' status'"
                      [attr.data-testid]="'shipment-advance-' + s.id"
                    >
                      @for (opt of statusOptions; track opt) {
                        <option [value]="opt" [selected]="opt === s.status">
                          {{ shipmentStatusLabel(opt) }}
                        </option>
                      }
                    </select>
                  </div>
                }
              </li>
            }
          </ul>
        }

        @if (!closed()) {
          <form
            [formGroup]="form"
            (ngSubmit)="createShipment()"
            class="flex flex-col gap-4"
            novalidate
          >
            <h3 class="text-xs tracking-widest uppercase text-ink-muted">New shipment</h3>

            @if (items().length > 0) {
              <fieldset class="flex flex-col gap-2" formArrayName="items">
                <legend class="text-xs tabular text-ink-muted">Items to ship</legend>
                @for (item of items(); track item.id; let i = $index) {
                  <label class="flex items-center gap-3 text-sm tabular text-ink">
                    <input
                      type="checkbox"
                      [formControl]="itemChecked(i)"
                      class="h-4 w-4"
                      [attr.data-testid]="'shipment-item-check-' + item.id"
                    />
                    <span class="flex-1 flex flex-col">
                      <span>{{ item.name }}</span>
                      @if (item.sku && item.sku !== item.name) {
                        <span class="text-xs text-ink-muted">{{ item.sku }}</span>
                      }
                    </span>
                    <input
                      type="number"
                      min="1"
                      [formControl]="itemQuantity(i)"
                      class="w-20 min-h-[44px] px-2 tabular-nums text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      [attr.data-testid]="'shipment-item-qty-' + item.id"
                      [attr.aria-label]="'Quantity for ' + item.name"
                    />
                  </label>
                }
              </fieldset>
            } @else {
              <p class="text-xs tabular text-ink-muted">No order items to ship.</p>
            }

            <app-form-field label="Carrier" fieldId="shipment-carrier">
              <input
                id="shipment-carrier"
                formControlName="carrier"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <app-form-field label="Tracking number" fieldId="shipment-tracking">
              <input
                id="shipment-tracking"
                formControlName="trackingNumber"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <div class="flex justify-end">
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="busy() || !hasCheckedItem()"
                [loading]="busy()"
                data-testid="shipment-create-submit"
              >
                Create shipment
              </app-button>
            </div>
          </form>
        }
      </div>
    </section>
  `,
})
export class OrderShipmentPanelComponent implements OnInit {
  private readonly ordersService = inject(OrdersService);
  private readonly fb = inject(FormBuilder);
  private readonly dialog = inject(Dialog);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);

  protected readonly shipmentStatusLabel = shipmentStatusLabel;
  protected readonly orderStatusLabel = orderStatusLabel;

  readonly order = input.required<Order>();
  readonly changed = output<void>();

  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * Mirror of Prisma ShipmentStatus (spec §4.3 table, schema.prisma:73-81),
   * minus CANCELLED. That value is written only by the order cancel cascade,
   * and the API refuses to move a row back out of it, so offering it here would
   * be offering a guaranteed 409.
   */
  readonly statusOptions: readonly WritableShipmentStatus[] = [
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
  ];

  /**
   * Mirror of `CLOSED_STATUSES` in `apps/api/.../orders.constants.ts`. Fulfilment
   * is over, and both shipment routes answer ORDER_SHIPMENT_ORDER_CLOSED.
   */
  private readonly closedStatuses: readonly string[] = ['CANCELLED', 'COMPLETED', 'RETURNED'];

  readonly closed = computed(() => this.closedStatuses.includes(String(this.order().status)));

  readonly items = computed<readonly OrderItem[]>(() => {
    const raw = this.order().items as unknown;
    if (!Array.isArray(raw)) return [];
    const locale = this.authStore.locale();
    const items: OrderItem[] = [];
    for (const it of raw) {
      const r = it as Record<string, unknown>;
      if (typeof r?.['id'] !== 'string') continue;
      const id = r['id'] as string;
      // The wire field is `sku`; `variantSku` is tolerated as a legacy key.
      const sku = (r['sku'] ?? r['variantSku']) as string | undefined;
      const productName = pickTranslation(
        r['productName'] as Translatable | string | null | undefined,
        locale,
        '',
        this.storeSettings.defaultLocale(),
      );
      const variantLabel = (r['variantLabel'] ?? '') as string;
      items.push({
        id,
        name: productName ? [productName, variantLabel].filter(Boolean).join(' · ') : (sku ?? id),
        sku,
        quantity: Number(r['quantity'] ?? 0),
      });
    }
    return items;
  });

  /**
   * Shipments carry no number column, so the operator label is positional.
   * Sorting by `createdAt` keeps "Shipment 1" pointing at the same shipment
   * across reloads.
   */
  readonly existing = computed<readonly ShipmentRow[]>(() => {
    const raw = this.order().shipments as unknown;
    if (!Array.isArray(raw)) return [];
    const rows: Array<ShipmentRow & { createdAt: string }> = [];
    for (const it of raw) {
      const r = it as Record<string, unknown>;
      if (typeof r?.['id'] !== 'string') continue;
      rows.push({
        id: r['id'] as string,
        label: '',
        carrier: (r['carrier'] ?? null) as string | null,
        trackingNumber: (r['trackingNumber'] ?? null) as string | null,
        status: (r['status'] ?? 'PROCESSING') as ShipmentStatus,
        createdAt: (r['createdAt'] ?? '') as string,
      });
    }
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rows.map((row, i) => ({
      id: row.id,
      label: `Shipment ${i + 1}`,
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      status: row.status,
    }));
  });

  readonly form = this.fb.nonNullable.group({
    carrier: [''],
    trackingNumber: [''],
    items: this.fb.array<FormControl<{ id: string; checked: boolean; quantity: number }>>([]),
  });

  ngOnInit(): void {
    this.rebuildItems();
  }

  hasCheckedItem(): boolean {
    return this.itemsArray().controls.some((c) => (c.value as { checked: boolean }).checked);
  }

  itemChecked(i: number): FormControl<boolean> {
    const group = this.itemsArray().at(i);
    const sub = this.fb.nonNullable.control((group.value as { checked: boolean }).checked ?? false);
    sub.valueChanges.subscribe((v) =>
      this.itemsArray()
        .at(i)
        .setValue({
          ...(this.itemsArray().at(i).value as { id: string; checked: boolean; quantity: number }),
          checked: v,
        }),
    );
    return sub;
  }

  itemQuantity(i: number): FormControl<number> {
    const group = this.itemsArray().at(i);
    const sub = this.fb.nonNullable.control((group.value as { quantity: number }).quantity ?? 1, [
      Validators.required,
      Validators.min(1),
    ]);
    sub.valueChanges.subscribe((v) =>
      this.itemsArray()
        .at(i)
        .setValue({
          ...(this.itemsArray().at(i).value as { id: string; checked: boolean; quantity: number }),
          quantity: Number(v),
        }),
    );
    return sub;
  }

  private itemsArray(): FormArray<FormControl<{ id: string; checked: boolean; quantity: number }>> {
    return this.form.controls.items as FormArray<
      FormControl<{ id: string; checked: boolean; quantity: number }>
    >;
  }

  private rebuildItems(): void {
    const arr = this.itemsArray();
    arr.clear();
    for (const it of this.items()) {
      arr.push(
        this.fb.nonNullable.control({ id: it.id, checked: false, quantity: it.quantity || 1 }),
      );
    }
  }

  createShipment(): void {
    if (this.busy()) return;
    const checked = this.itemsArray()
      .controls.map((c) => c.value as { id: string; checked: boolean; quantity: number })
      .filter((v) => v.checked);
    if (checked.length === 0) return;

    const payload: CreateShipmentRequest = {
      items: [
        { orderItemId: checked[0].id, quantity: Math.max(1, checked[0].quantity) },
        ...checked.slice(1).map((v) => ({ orderItemId: v.id, quantity: Math.max(1, v.quantity) })),
      ] as CreateShipmentRequest['items'],
      ...(this.form.value.carrier ? { carrier: this.form.value.carrier } : {}),
      ...(this.form.value.trackingNumber ? { trackingNumber: this.form.value.trackingNumber } : {}),
    };

    this.busy.set(true);
    this.error.set(null);
    this.ordersService.createShipment(this.order().id, payload).subscribe({
      next: () => {
        this.busy.set(false);
        this.saved.set(true);
        this.form.reset({ carrier: '', trackingNumber: '' });
        this.rebuildItems();
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  advanceShipment(row: ShipmentRow, event: Event): void {
    const target = event.target as HTMLSelectElement;
    const parsed = writableShipmentStatusSchema.safeParse(target.value);
    if (!parsed.success) return;
    // The backend writes whatever it is sent with no transition check, so a
    // stray change event that repeats the current status must not round-trip.
    if (parsed.data === row.status) return;
    const payload: UpdateShipmentRequest = { status: parsed.data };
    this.busy.set(true);
    this.error.set(null);
    this.ordersService.updateShipment(this.order().id, row.id, payload).subscribe({
      next: () => {
        this.busy.set(false);
        this.saved.set(true);
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiConflictError) return 'Shipment state rejected by the server.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage shipments.';
    if (err instanceof ApiNotFoundError) return 'Shipment not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save shipment. Please retry.';
  }
}
