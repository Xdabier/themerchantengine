import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TextareaComponent,
} from '@admin-ui';
import {
  OrdersService,
  ProductsService,
  type EditOrderRequest,
  type Order,
  type Product,
} from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { CurrencyStore } from '../../core/stores/currency.store';
import { MoneyAffixStore } from '../../core/stores/money-affix.store';
import { moneyScaleFactor } from '@admin-types';
import { CountrySelectComponent } from '../../shared/components/country-select.component';
import { EntitySelectComponent } from '../../shared/entity-select/entity-select.component';
import { TranslatablePipe } from '../../shared/pipes/translatable.pipe';
import { createProductSource } from './order-picker-sources';
import { canEditOrder, formatMoney, orderStatusLabel } from './orders.utils';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

interface ShippingAddress {
  fullName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

interface QueuedAddition {
  variantId: string;
  quantity: number;
  label: string;
}

interface AddVariantOption {
  id: string;
  label: string;
}

@Component({
  selector: 'app-order-edit-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    CountrySelectComponent,
    EntitySelectComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TextareaComponent,
    TranslatablePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="order-edit-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/orders"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Orders
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <a
          [routerLink]="['/orders', orderId()]"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          {{ order()?.orderNumber ?? orderId() }}
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Edit</span>
      </nav>

      @if (loading()) {
        <app-skeleton height="2.5rem" width="40%" />
        <app-skeleton height="12rem" width="100%" />
      } @else if (error()) {
        <p class="border border-status-error text-ink p-3 tabular text-xs" role="alert">
          {{ error() }}
        </p>
      } @else {
        <header>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Edit order</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight tabular">
            {{ order()?.orderNumber ?? orderId() }}
          </h1>
          <p class="mt-3 text-ink-muted text-sm">
            Add or remove items, update the shipping address, apply a manual discount, or leave an
            internal note.
          </p>
        </header>

        @if (!editable()) {
          <p
            class="border border-status-warning text-ink p-3 tabular text-xs max-w-2xl"
            role="status"
            data-testid="order-edit-locked"
          >
            This order is {{ orderStatusLabel(order()?.status) }} and can no longer be edited. Only
            orders that have not shipped accept changes.
          </p>
        }

        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="flex flex-col gap-8 max-w-2xl"
          novalidate
        >
          <fieldset class="border border-line p-5 flex flex-col gap-4">
            <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">Items</legend>

            @if (items().length === 0) {
              <p class="text-sm text-ink-muted">This order has no line items.</p>
            }
            <ul class="flex flex-col gap-2">
              @for (item of items(); track item.id) {
                <li
                  class="flex items-center justify-between gap-4 border border-surface-elevated px-3 py-3"
                  [class.opacity-50]="isPendingRemoval(item.id)"
                  [attr.data-testid]="'order-edit-item-' + item.id"
                >
                  <div class="min-w-0">
                    <p
                      class="text-sm text-ink truncate"
                      [class.line-through]="isPendingRemoval(item.id)"
                    >
                      {{ item.productName | translatable: item.sku ?? '—' }}
                    </p>
                    <p class="text-xs tabular text-ink-muted">
                      {{ item.sku ?? '—' }} · {{ item.quantity }} ×
                      {{ money(item.unitPrice) }}
                    </p>
                  </div>
                  <div class="flex items-center gap-3 shrink-0">
                    <span class="text-sm tabular-nums text-ink">
                      {{ money(item.total) }}
                    </span>
                    <app-button
                      type="button"
                      variant="ghost"
                      size="sm"
                      [disabled]="!editable()"
                      [ariaLabel]="
                        (isPendingRemoval(item.id) ? 'Keep ' : 'Remove ') + (item.sku ?? item.id)
                      "
                      (clicked)="toggleRemoval(item.id)"
                      [attr.data-testid]="'order-edit-remove-' + item.id"
                    >
                      {{ isPendingRemoval(item.id) ? 'Keep' : 'Remove' }}
                    </app-button>
                  </div>
                </li>
              }
            </ul>

            @if (addQueue().length > 0) {
              <ul class="flex flex-col gap-2" data-testid="order-edit-add-queue">
                @for (queued of addQueue(); track queued.variantId; let i = $index) {
                  <li class="flex items-center justify-between gap-4 border border-ink px-3 py-3">
                    <p class="text-sm text-ink">
                      Adding {{ queued.quantity }} × {{ queued.label }}
                    </p>
                    <app-button
                      type="button"
                      variant="ghost"
                      size="sm"
                      [ariaLabel]="'Drop queued item ' + queued.label"
                      (clicked)="removeAddition(i)"
                    >
                      Drop
                    </app-button>
                  </li>
                }
              </ul>
            }

            @if (editable()) {
              <div class="grid gap-3 md:grid-cols-[1fr_1fr_6rem_auto] items-end pt-2">
                <app-form-field label="Add product" fieldId="order-edit-add-product">
                  <app-entity-select
                    id="order-edit-add-product"
                    testId="order-edit-add-product"
                    ariaLabel="Add product"
                    listboxLabel="Products"
                    placeholder="Search by name or SKU…"
                    [source]="productSource"
                    (selectionChange)="onAddProductPicked($event)"
                  />
                </app-form-field>
                <app-form-field label="Variant" fieldId="order-edit-add-variant">
                  <select
                    id="order-edit-add-variant"
                    class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                    [disabled]="addVariants().length === 0"
                    data-testid="order-edit-add-variant"
                    (change)="onAddVariantPicked($event)"
                  >
                    <option value="">
                      {{ addVariants().length ? 'Select a variant…' : 'Pick a product first' }}
                    </option>
                    @for (v of addVariants(); track v.id) {
                      <option [value]="v.id" [selected]="v.id === addVariantId()">
                        {{ v.label }}
                      </option>
                    }
                  </select>
                </app-form-field>
                <app-form-field label="Qty" fieldId="order-edit-add-qty">
                  <input
                    id="order-edit-add-qty"
                    type="number"
                    min="1"
                    [value]="addQuantity()"
                    (input)="onAddQuantity($event)"
                    class="w-full min-h-[44px] px-3 py-2 tabular-nums text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  />
                </app-form-field>
                <app-button
                  type="button"
                  variant="secondary"
                  size="md"
                  [disabled]="!addVariantId()"
                  (clicked)="stageAddition()"
                  data-testid="order-edit-add-item"
                >
                  Add item
                </app-button>
              </div>
            }
          </fieldset>

          <fieldset
            class="border border-line p-5 flex flex-col gap-4"
            formGroupName="shippingAddress"
          >
            <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">
              Shipping address
            </legend>

            <app-form-field label="Full name" fieldId="edit-fullName">
              <input
                id="edit-fullName"
                formControlName="fullName"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <app-form-field label="Phone" fieldId="edit-phone">
              <input
                id="edit-phone"
                formControlName="phone"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <app-form-field label="Address line 1" fieldId="edit-addr1">
              <input
                id="edit-addr1"
                formControlName="addressLine1"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <app-form-field label="Address line 2" fieldId="edit-addr2">
              <input
                id="edit-addr2"
                formControlName="addressLine2"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <app-form-field label="City" fieldId="edit-city">
              <input
                id="edit-city"
                formControlName="city"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <app-form-field label="State / region" fieldId="edit-state">
              <input
                id="edit-state"
                formControlName="state"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <app-form-field label="Postal code" fieldId="edit-postal">
              <input
                id="edit-postal"
                formControlName="postalCode"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              />
            </app-form-field>

            <app-form-field label="Country" fieldId="edit-country" [error]="countryError()">
              <app-country-select id="edit-country" formControlName="country" />
            </app-form-field>
          </fieldset>

          <app-form-field
            label="Manual discount"
            fieldId="edit-discount"
            [hint]="discountHint()"
            [error]="discountError()"
          >
            <div class="w-40">
              <app-input
                id="edit-discount"
                type="number"
                min="0"
                [step]="moneyStep()"
                formControlName="manualDiscount"
                [prefix]="recordAffix().prefix"
                [suffix]="recordAffix().suffix"
                [ariaLabel]="
                  'Manual discount' + (order()?.currency ? ' in ' + order()?.currency : '')
                "
                data-testid="order-edit-discount"
              />
            </div>
          </app-form-field>

          <app-form-field
            label="Internal notes"
            fieldId="edit-internalNotes"
            [hint]="'Visible to staff only — never emailed to the customer.'"
          >
            <app-textarea
              id="edit-internalNotes"
              formControlName="internalNotes"
              [rows]="3"
            ></app-textarea>
          </app-form-field>

          @if (submitError()) {
            <p
              class="border border-status-error text-ink p-3 tabular text-xs"
              role="alert"
              data-testid="order-edit-error"
            >
              {{ submitError() }}
            </p>
          }

          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="order-edit-saved-region"
          >
            @if (saved()) {
              <p
                class="border border-status-success text-ink p-3 tabular text-xs"
                data-testid="order-edit-saved"
              >
                Saved.
              </p>
            }
          </div>

          <div class="flex items-center justify-end gap-3">
            <p class="text-xs tabular text-ink-muted me-auto" data-testid="order-edit-dirty">
              {{ form.dirty || itemsDirty() ? 'Unsaved changes' : 'No changes' }}
            </p>
            <a
              [routerLink]="['/orders', orderId()]"
              class="text-xs tracking-widest uppercase px-3 py-2 min-h-[44px] inline-flex items-center border border-line text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              Back
            </a>
            <app-button
              type="submit"
              variant="primary"
              size="md"
              [disabled]="form.invalid || busy() || !editable() || (!form.dirty && !itemsDirty())"
              [loading]="busy()"
              data-testid="order-edit-submit"
            >
              Save
            </app-button>
          </div>
        </form>
      }
    </section>
  `,
})
export class OrderEditPage implements OnInit, OnDestroy {
  private readonly ordersService = inject(OrdersService);
  private readonly products = inject(ProductsService);
  private readonly currencyStore = inject(CurrencyStore);
  private readonly moneyAffix = inject(MoneyAffixStore);

  /**
   * The order's own currency, on the side the store writes its money.
   *
   * An order is settled in the currency it was placed in, so the field names
   * that one rather than today's store default.
   */
  protected readonly recordAffix = computed(() =>
    this.moneyAffix.affixesFor(this.order()?.currency ?? null),
  );

  /**
   * The native `step`, driven by the store currency rather than hardcoded.
   * `step="0.01"` made the browser's own constraint validation reject a
   * millime before Angular ever saw the value, so an operator on a
   * three-decimal currency could not enter a legal price.
   */
  protected readonly moneyStep = computed(
    () => 1 / moneyScaleFactor(this.currencyStore.decimalPlaces()),
  );

  private readonly authStore = inject(AuthStore);

  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly submitError = signal<string | null>(null);
  readonly saved = signal(false);
  readonly busy = signal(false);
  readonly order = signal<Order | null>(null);
  readonly orderId = signal<string>('');

  /** Queued line mutations. Nothing reaches the API until Save. */
  readonly removeQueue = signal<readonly string[]>([]);
  readonly addQueue = signal<readonly QueuedAddition[]>([]);

  readonly addVariants = signal<readonly AddVariantOption[]>([]);
  readonly addVariantId = signal<string>('');
  readonly addQuantity = signal<number>(1);

  readonly productSource = createProductSource(
    this.products,
    () => this.authStore.locale(),
    () => this.storeSettings.defaultLocale(),
  );

  readonly items = computed(() => this.order()?.items ?? []);
  /** The API refuses every edit outside EDITABLE_STATUSES, so mirror that here. */
  readonly editable = computed(() => canEditOrder(this.order()?.status));

  protected readonly orderStatusLabel = orderStatusLabel;

  /**
   * Record currency: the discount applies to this order, so it is named in the
   * order's own currency, not the store default.
   */
  protected discountHint(): string {
    const currency = this.order()?.currency;
    const unit = currency ? ` Amount in ${currency}.` : '';
    return `Amount to subtract from the order total. 0 means no change.${unit}`;
  }

  readonly form = this.fb.nonNullable.group({
    shippingAddress: this.fb.nonNullable.group({
      fullName: [''],
      phone: [''],
      addressLine1: [''],
      addressLine2: [''],
      city: [''],
      state: [''],
      postalCode: [''],
      country: ['', [Validators.pattern(/^[A-Z]{2}$/)]],
    }),
    manualDiscount: this.fb.nonNullable.control<number>(0, [Validators.min(0)]),
    internalNotes: [''],
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.error.set('Missing order id.');
        this.loading.set(false);
        return;
      }
      this.orderId.set(id);
      this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Plain method, never a `computed()`: reading `form.dirty` inside a computed
   * is untracked in this zoneless app, so the memo would freeze on its first
   * value and the Save button would never wake up.
   */
  itemsDirty(): boolean {
    return this.removeQueue().length > 0 || this.addQueue().length > 0;
  }

  isPendingRemoval(itemId: string): boolean {
    return this.removeQueue().includes(itemId);
  }

  toggleRemoval(itemId: string): void {
    this.removeQueue.update((queue) =>
      queue.includes(itemId) ? queue.filter((id) => id !== itemId) : [...queue, itemId],
    );
  }

  onAddProductPicked(option: { value: Product } | null): void {
    const variants = (option?.value.variants ?? []).filter((v) => v.isActive !== false);
    this.addVariants.set(
      variants.map((v) => ({ id: v.id, label: `${v.sku} (${this.money(v.price)})` })),
    );
    this.addVariantId.set(variants.length === 1 ? variants[0].id : '');
  }

  onAddVariantPicked(event: Event): void {
    this.addVariantId.set((event.target as HTMLSelectElement).value);
  }

  onAddQuantity(event: Event): void {
    const next = Number((event.target as HTMLInputElement).value);
    this.addQuantity.set(Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1);
  }

  stageAddition(): void {
    const variantId = this.addVariantId();
    if (!variantId) return;
    const label = this.addVariants().find((v) => v.id === variantId)?.label ?? variantId;
    this.addQueue.update((queue) => [
      ...queue,
      { variantId, quantity: this.addQuantity(), label: label.replace(/\s*\(.*\)$/, '') },
    ]);
    this.addVariants.set([]);
    this.addVariantId.set('');
    this.addQuantity.set(1);
  }

  removeAddition(index: number): void {
    this.addQueue.update((queue) => queue.filter((_, i) => i !== index));
  }

  /** Line money uses the currency recorded on the order, not the store default. */
  money(value: number | string | null | undefined): string {
    return formatMoney(value, this.order()?.currency);
  }

  countryError(): string | null {
    const ctrl = (this.form.controls.shippingAddress as FormGroup).get('country');
    if (!ctrl?.touched || ctrl.valid) return null;
    if (ctrl.hasError('pattern')) return 'Two uppercase letters required.';
    return null;
  }

  discountError(): string | null {
    const ctrl = this.form.controls.manualDiscount;
    if (!ctrl.touched || ctrl.valid) return null;
    if (ctrl.hasError('min')) return 'Discount cannot be negative.';
    return null;
  }

  submit(): void {
    if (this.form.invalid || this.busy() || !this.editable()) return;
    this.busy.set(true);
    this.submitError.set(null);
    this.saved.set(false);

    const raw = this.form.getRawValue();
    const payload: EditOrderRequest = {};
    const address = raw.shippingAddress;
    if (
      address.fullName ||
      address.phone ||
      address.addressLine1 ||
      address.city ||
      address.country
    ) {
      if (
        address.fullName &&
        address.phone &&
        address.addressLine1 &&
        address.city &&
        address.country
      ) {
        payload.shippingAddress = {
          fullName: address.fullName,
          phone: address.phone,
          addressLine1: address.addressLine1,
          ...(address.addressLine2 ? { addressLine2: address.addressLine2 } : {}),
          city: address.city,
          ...(address.state ? { state: address.state } : {}),
          ...(address.postalCode ? { postalCode: address.postalCode } : {}),
          country: address.country,
        };
      }
    }
    payload.manualDiscount = Number(raw.manualDiscount) || 0;
    if (raw.internalNotes) payload.internalNotes = raw.internalNotes;
    const additions = this.addQueue();
    if (additions.length > 0) {
      payload.addItems = additions.map(({ variantId, quantity }) => ({ variantId, quantity }));
    }
    const removals = this.removeQueue();
    if (removals.length > 0) {
      payload.removeItems = removals.map((orderItemId) => ({ orderItemId }));
    }

    this.ordersService
      .edit(this.orderId(), payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => {
          this.order.set(updated);
          this.busy.set(false);
          this.saved.set(true);
          this.resetQueues();
          // `reset` marks the form pristine, which re-arms the dirty gate.
          this.form.reset(this.form.getRawValue());
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.submitError.set(this.formatError(err));
        },
      });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.ordersService
      .get(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (order) => {
          this.order.set(order);
          this.loading.set(false);
          this.prefill(order);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private resetQueues(): void {
    this.removeQueue.set([]);
    this.addQueue.set([]);
    this.addVariants.set([]);
    this.addVariantId.set('');
    this.addQuantity.set(1);
  }

  private prefill(order: Order): void {
    const raw = order.shippingAddress as ShippingAddress | null | undefined;
    if (raw) {
      (this.form.controls.shippingAddress as FormGroup).patchValue({
        fullName: raw.fullName ?? '',
        phone: raw.phone ?? '',
        addressLine1: raw.addressLine1 ?? '',
        addressLine2: raw.addressLine2 ?? '',
        city: raw.city ?? '',
        state: raw.state ?? '',
        postalCode: raw.postalCode ?? '',
        country: raw.country ?? '',
      });
    }
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to edit orders.';
    if (err instanceof ApiNotFoundError) return 'Order not found.';
    if (err instanceof ApiConflictError)
      return 'Order state rejected the change. Refresh and retry.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save. Please retry.';
  }
}
