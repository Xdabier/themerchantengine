import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent, LoadErrorComponent } from '@admin-ui';
import { ApiError, pickTranslation } from '@admin-types';
import {
  CountriesService,
  OrdersService,
  type Product,
  ProductsService,
  ShippingService,
  UsersService,
  type CreateAdminOrderRequest,
} from '@admin-services';
import { AuthStore } from '../../core/stores/auth.store';
import { CurrencyStore } from '../../core/stores/currency.store';
import { CountrySelectComponent } from '../../shared/components/country-select.component';
import { EntitySelectComponent } from '../../shared/entity-select/entity-select.component';
import { formatMoney } from '../../shared/format/money';
import { createCustomerSource, createProductSource } from './order-picker-sources';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

interface VariantOption {
  id: string;
  label: string;
  price: number;
}
interface MethodOption {
  id: string;
  label: string;
  price: number;
  isDefault: boolean;
}
interface ItemRow {
  group: FormGroup;
  variants: WritableSignal<readonly VariantOption[]>;
}

/**
 * Admin manual order creation (phone / walk-in). The shipping-method picker is
 * preselected to the zone's default standard method; live totals show the
 * subtotal + shipping the operator is about to charge. Backend computes tax and
 * the authoritative total — the panel here is an operator-facing estimate.
 */
@Component({
  selector: 'app-order-new-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    CountrySelectComponent,
    EntitySelectComponent,
    FormFieldComponent,
    InputComponent,
    LoadErrorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="order-new-page">
      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Orders</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">New order</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Place a manual order for a customer. Shipping defaults to the store's standard method.
          </p>
        </div>
        <a
          routerLink="/orders"
          class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-5 py-3 text-sm min-h-[44px]"
          data-testid="order-new-cancel"
        >
          Cancel
        </a>
      </header>

      @if (loading()) {
        <p class="text-sm text-ink-muted" role="status">Loading…</p>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-8">
          @if (topError()) {
            <app-load-error
              [message]="topError()!"
              [retrying]="loading()"
              retryLabel="shipping methods"
              testId="order-new-error"
              (retry)="reloadLookups()"
            />
          }

          <app-form-field
            label="Customer"
            [fieldId]="customerId"
            hint="Search by name or email. Leave empty for a guest order."
          >
            <app-entity-select
              [id]="customerId"
              testId="order-new-customer"
              ariaLabel="Customer"
              listboxLabel="Customers"
              placeholder="Search customers…"
              formControlName="userId"
              [source]="customerSource"
            />
          </app-form-field>

          <fieldset class="flex flex-col gap-4 border border-line p-5">
            <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">Items</legend>
            <div formArrayName="items" class="flex flex-col gap-4">
              @for (row of itemRows(); track row.group; let i = $index) {
                <div
                  [formGroupName]="i"
                  class="grid gap-3 md:grid-cols-[1fr_1fr_8rem_auto] items-end"
                >
                  <app-form-field label="Product" [fieldId]="'item-product-' + i">
                    <app-entity-select
                      [id]="'item-product-' + i"
                      [testId]="'order-new-product-' + i"
                      ariaLabel="Product"
                      listboxLabel="Products"
                      placeholder="Search by name or SKU…"
                      formControlName="productId"
                      [source]="productSource"
                      (selectionChange)="onProductPicked(row, $event)"
                    />
                  </app-form-field>
                  <app-form-field label="Variant" [fieldId]="'item-variant-' + i">
                    <select
                      [id]="'item-variant-' + i"
                      formControlName="variantId"
                      [disabled]="row.variants().length === 0"
                      class="min-h-[44px] w-full px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      [attr.data-testid]="'order-new-variant-' + i"
                    >
                      <option value="">
                        {{ row.variants().length ? 'Select a variant…' : 'Pick a product first' }}
                      </option>
                      @for (v of row.variants(); track v.id) {
                        <option
                          [value]="v.id"
                          [selected]="v.id === row.group.get('variantId')?.value"
                        >
                          {{ v.label }}
                        </option>
                      }
                    </select>
                  </app-form-field>
                  <app-form-field label="Qty" [fieldId]="'item-qty-' + i">
                    <app-input
                      [id]="'item-qty-' + i"
                      type="number"
                      min="1"
                      formControlName="quantity"
                    />
                  </app-form-field>
                  <app-button
                    type="button"
                    variant="ghost"
                    [ariaLabel]="'Remove item ' + (i + 1)"
                    (clicked)="removeItem(i)"
                    [disabled]="itemRows().length === 1"
                  >
                    Remove
                  </app-button>
                </div>
              }
            </div>
            <app-button
              type="button"
              variant="secondary"
              (clicked)="addItem()"
              data-testid="order-new-add-item"
            >
              Add item
            </app-button>
          </fieldset>

          <fieldset
            class="grid gap-4 md:grid-cols-2 border border-line p-5"
            formGroupName="shippingAddress"
          >
            <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">
              Shipping address
            </legend>
            <app-form-field label="Full name" [fieldId]="'addr-fullName'">
              <app-input id="addr-fullName" formControlName="fullName" />
            </app-form-field>
            <app-form-field label="Phone" [fieldId]="'addr-phone'">
              <app-input id="addr-phone" formControlName="phone" />
            </app-form-field>
            <app-form-field label="Address line 1" [fieldId]="'addr-line1'">
              <app-input id="addr-line1" formControlName="addressLine1" />
            </app-form-field>
            <app-form-field label="Address line 2" [fieldId]="'addr-line2'" hint="Optional.">
              <app-input id="addr-line2" formControlName="addressLine2" />
            </app-form-field>
            <app-form-field label="City" [fieldId]="'addr-city'">
              <app-input id="addr-city" formControlName="city" />
            </app-form-field>
            <app-form-field label="State" [fieldId]="'addr-state'" hint="Optional.">
              <app-input id="addr-state" formControlName="state" />
            </app-form-field>
            <app-form-field label="Postal code" [fieldId]="'addr-postal'" hint="Optional.">
              <app-input id="addr-postal" formControlName="postalCode" />
            </app-form-field>
            <app-form-field label="Country" [fieldId]="'addr-country'">
              <app-country-select id="addr-country" formControlName="country" />
            </app-form-field>
          </fieldset>

          <div class="grid gap-4 md:grid-cols-2">
            <app-form-field
              label="Shipping method"
              [fieldId]="methodId"
              hint="Standard is preselected."
            >
              <select
                [id]="methodId"
                formControlName="shippingMethodId"
                class="min-h-[44px] w-full px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                data-testid="order-new-method"
              >
                @for (m of methodOptions(); track m.id) {
                  <option [value]="m.id">{{ m.label }}</option>
                }
              </select>
            </app-form-field>
            <app-form-field label="Coupon code" [fieldId]="'order-coupon'" hint="Optional.">
              <app-input id="order-coupon" formControlName="couponCode" />
            </app-form-field>
          </div>

          <app-form-field label="Notes" [fieldId]="'order-notes'" hint="Optional internal note.">
            <app-input id="order-notes" formControlName="notes" />
          </app-form-field>

          <dl
            class="grid grid-cols-1 sm:grid-cols-3 gap-4"
            data-testid="order-new-totals"
            aria-live="polite"
          >
            <div class="border border-line bg-surface p-5">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Subtotal</dt>
              <dd class="mt-2 text-2xl font-bold tabular-nums" data-testid="order-new-subtotal">
                {{ money(totals().subtotal) }}
              </dd>
            </div>
            <div class="border border-line bg-surface p-5">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Shipping</dt>
              <dd class="mt-2 text-2xl font-bold tabular-nums" data-testid="order-new-shipping">
                {{ money(totals().shipping) }}
              </dd>
            </div>
            <div class="border border-ink bg-surface p-5">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Estimated total</dt>
              <dd
                class="mt-2 text-2xl font-bold tabular-nums text-ink"
                data-testid="order-new-total"
              >
                {{ money(totals().total) }}
              </dd>
            </div>
          </dl>

          <div class="flex items-center justify-end gap-3 pt-2">
            <app-button
              type="submit"
              [disabled]="form.invalid || saving()"
              [loading]="saving()"
              data-testid="order-new-submit"
            >
              Create order
            </app-button>
          </div>
        </form>
      }
    </section>
  `,
})
export class OrderNewPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly orders = inject(OrdersService);
  private readonly products = inject(ProductsService);
  private readonly users = inject(UsersService);
  private readonly shipping = inject(ShippingService);
  private readonly countries = inject(CountriesService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currencyStore = inject(CurrencyStore);

  readonly customerId = 'order-customer';
  readonly methodId = 'order-method';

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly topError = signal<string | null>(null);
  readonly methodOptions = signal<readonly MethodOption[]>([]);
  readonly itemRows = signal<readonly ItemRow[]>([]);
  readonly totals = signal<{ subtotal: number; shipping: number; total: number }>({
    subtotal: 0,
    shipping: 0,
    total: 0,
  });

  private readonly variantPrice = new Map<string, number>();
  private readonly methodById = new Map<string, { price: number; isDefault: boolean }>();

  /**
   * Shared, server-searched lookups. The single `pageSize=100` fetch these
   * replaced put every product past the first hundred permanently out of
   * reach of a manual order, with nothing on screen admitting it.
   */
  readonly productSource = createProductSource(
    this.products,
    () => this.authStore.locale(),
    () => this.storeSettings.defaultLocale(),
  );
  readonly customerSource = createCustomerSource(this.users);

  readonly form = this.fb.group({
    userId: this.fb.nonNullable.control<string>(''),
    items: this.fb.array<FormGroup>([this.buildItemRow()]),
    shippingAddress: this.fb.group({
      fullName: this.fb.nonNullable.control('', [Validators.required]),
      phone: this.fb.nonNullable.control('', [Validators.required]),
      addressLine1: this.fb.nonNullable.control('', [Validators.required]),
      addressLine2: this.fb.nonNullable.control(''),
      city: this.fb.nonNullable.control('', [Validators.required]),
      state: this.fb.nonNullable.control(''),
      postalCode: this.fb.nonNullable.control(''),
      // Pre-load placeholder only: replaced by the store's default country as
      // soon as the catalogue answers, so the form is never empty and never
      // hardcodes one market.
      country: this.fb.nonNullable.control('QA', [
        Validators.required,
        Validators.pattern(/^[A-Z]{2}$/),
      ]),
    }),
    shippingMethodId: this.fb.nonNullable.control<string>(''),
    couponCode: this.fb.nonNullable.control<string>(''),
    notes: this.fb.nonNullable.control<string>(''),
  });

  get items(): FormArray {
    return this.form.controls.items;
  }

  ngOnInit(): void {
    this.itemRows.set((this.items.controls as FormGroup[]).map((group) => this.wrapRow(group)));
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recomputeTotals());

    // Cached read, so this shares the request the country select already makes.
    this.countries
      .listCached()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ defaultCode }) => {
          const ctrl = this.form.controls.shippingAddress.controls.country;
          if (defaultCode && ctrl.pristine) ctrl.setValue(defaultCode);
        },
        // query-error-guard: allow — no default to apply without the country
        // catalogue, and the country select owns its own error surface. The
        // 'QA' placeholder stands and the operator can still pick a country.
        error: () => undefined,
      });

    this.fetchMethods();
  }

  /** Re-fire the boot lookup after a failure, without a full page reload. */
  reloadLookups(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.topError.set(null);
    this.fetchMethods();
  }

  private fetchMethods(): void {
    // Products and customers are reached through their pickers now, so the
    // only list this page still has to preload is the method select.
    this.shipping
      .listMethods({ pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (methods) => {
          const locale = this.authStore.locale();
          const methodOpts: MethodOption[] = [];
          for (const m of methods.data) {
            if (!m.isActive) continue;
            const price = typeof m.price === 'number' ? m.price : 0;
            const isDefault = m.isDefault === true;
            this.methodById.set(m.id, { price, isDefault });
            methodOpts.push({
              id: m.id,
              label: `${pickTranslation(m.name, locale, '', this.storeSettings.defaultLocale())} (${this.money(price)})${
                isDefault ? ' · default' : ''
              }`,
              price,
              isDefault,
            });
          }
          this.methodOptions.set(methodOpts);
          const preselect = methodOpts.find((m) => m.isDefault) ?? methodOpts[0];
          if (preselect) this.form.controls.shippingMethodId.setValue(preselect.id);

          this.recomputeTotals();
          this.loading.set(false);
        },
        error: () => {
          this.topError.set('Could not load shipping methods.');
          this.loading.set(false);
        },
      });
  }

  addItem(): void {
    const group = this.buildItemRow();
    this.items.push(group);
    this.itemRows.set([...this.itemRows(), this.wrapRow(group)]);
  }

  removeItem(index: number): void {
    if (this.items.length === 1) return;
    this.items.removeAt(index);
    this.itemRows.set(this.itemRows().filter((_, i) => i !== index));
    this.recomputeTotals();
  }

  /** A product choice replaces the row's variant list and clears the old pick. */
  onProductPicked(row: ItemRow, option: { value: Product } | null): void {
    const variants = (option?.value.variants ?? []).filter((v) => v.isActive !== false);
    row.variants.set(
      variants.map((v) => {
        const price = Number(v.price) || 0;
        this.variantPrice.set(v.id, price);
        return { id: v.id, label: `${v.sku} (${this.money(price)})`, price };
      }),
    );
    // Exactly one variant is not a choice, so make it for the operator.
    const only = variants.length === 1 ? variants[0].id : '';
    row.group.get('variantId')?.setValue(only);
    this.recomputeTotals();
  }

  submit(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const raw = this.form.getRawValue();
    const addr = raw.shippingAddress;
    const body: CreateAdminOrderRequest = {
      ...(raw.userId ? { userId: raw.userId } : {}),
      items: (raw.items as Array<{ variantId: string; quantity: number }>).map((i) => ({
        variantId: i.variantId,
        quantity: Number(i.quantity) || 1,
      })),
      shippingAddress: {
        fullName: addr.fullName,
        phone: addr.phone,
        addressLine1: addr.addressLine1,
        ...(addr.addressLine2 ? { addressLine2: addr.addressLine2 } : {}),
        city: addr.city,
        ...(addr.state ? { state: addr.state } : {}),
        ...(addr.postalCode ? { postalCode: addr.postalCode } : {}),
        country: addr.country,
      },
      ...(raw.shippingMethodId ? { shippingMethodId: raw.shippingMethodId } : {}),
      ...(raw.couponCode ? { couponCode: raw.couponCode } : {}),
      ...(raw.notes ? { notes: raw.notes } : {}),
    };

    this.saving.set(true);
    this.topError.set(null);
    this.orders.create(body).subscribe({
      next: (order) => {
        void this.router.navigate(['/orders', order.id]);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.topError.set(
          err instanceof ApiError ? err.message : 'Could not create the order. Please try again.',
        );
      },
    });
  }

  /**
   * Store currency, not a hardcoded one. The literal this replaced was
   * also the wrong shape: the admin renders the code before the amount.
   */
  money(value: number): string {
    return formatMoney(value, this.currencyStore.config());
  }

  private buildItemRow(): FormGroup {
    return this.fb.group({
      // Picker-only: the API takes variants, so this never reaches the payload.
      productId: this.fb.nonNullable.control(''),
      variantId: this.fb.nonNullable.control('', [Validators.required]),
      quantity: this.fb.nonNullable.control(1, [Validators.required, Validators.min(1)]),
    });
  }

  private wrapRow(group: FormGroup): ItemRow {
    return { group, variants: signal<readonly VariantOption[]>([]) };
  }

  private recomputeTotals(): void {
    const raw = this.form.getRawValue();
    let subtotal = 0;
    for (const it of raw.items as Array<{ variantId: string; quantity: number }>) {
      subtotal += (this.variantPrice.get(it.variantId) ?? 0) * (Number(it.quantity) || 0);
    }
    const method = this.methodById.get(raw.shippingMethodId ?? '');
    const shipping = method ? method.price : 0;
    this.totals.set({ subtotal, shipping, total: subtotal + shipping });
  }
}
