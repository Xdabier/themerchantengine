import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
} from '@angular/forms';
import { NgFor } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  TranslatableInputComponent,
  type TranslatableValue,
} from '@admin-ui';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  ShippingService,
  type CreateShippingMethodRequest,
  type ShippingMethod,
  type ShippingMethodType,
  type ShippingZone,
  type UpdateShippingMethodRequest,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { METHOD_TYPE_LABELS } from './shipping.utils';
import { CurrencyStore } from '../../core/stores/currency.store';
import { MoneyAffixStore } from '../../core/stores/money-affix.store';
import { moneyScaleFactor } from '@admin-types';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';

@Component({
  selector: 'app-shipping-method-editor-page',
  standalone: true,
  imports: [
    NgFor,
    RouterLink,
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="shipping-method-editor-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/shipping/methods" class="hover:underline">Shipping methods</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">{{ isEditMode() ? 'Edit' : 'New' }}</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
          {{ isEditMode() ? 'Edit shipping method' : 'Create shipping method' }}
        </h1>
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="method-error"
        [class.border]="!!topError()"
        [class.border-status-error]="!!topError()"
        [class.text-ink]="!!topError()"
        [class.p-3]="!!topError()"
      >
        {{ topError() ?? '' }}
      </p>

      @if (loadingInitial()) {
        <p role="status" aria-live="polite" class="text-sm text-ink-muted">Loading…</p>
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="flex flex-col gap-6 border border-line bg-surface p-6 md:p-8 max-w-3xl"
          novalidate
        >
          <app-form-field
            label="Zone"
            [fieldId]="zoneId"
            [error]="zoneError()"
            hint="Methods belong to a single zone and cannot be moved after creation."
            [required]="true"
          >
            <select
              [id]="zoneId"
              [attr.aria-describedby]="zoneId + '-hint'"
              formControlName="zoneId"
              required
              class="min-h-[44px] w-full md:w-96 px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="method-zone"
            >
              <option value="" disabled>— Select zone —</option>
              @for (z of zones(); track z.id) {
                <option [value]="z.id">{{ zoneName(z) }}</option>
              }
            </select>
          </app-form-field>

          <app-form-field label="Name" [fieldId]="nameId" [error]="nameError()" [required]="true">
            <app-translatable-input
              [inputId]="nameId"
              testId="method-name"
              idPrefix="method-name"
              label="Method name"
              formControlName="name"
              [invalid]="!!nameError()"
            />
          </app-form-field>

          <app-form-field
            label="Type"
            [fieldId]="typeId"
            hint="Selects which configuration block applies."
            [required]="true"
          >
            <select
              [id]="typeId"
              [attr.aria-describedby]="typeId + '-hint'"
              formControlName="type"
              required
              class="min-h-[44px] w-full md:w-96 px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="method-type"
            >
              @for (t of typeOptions; track t) {
                <option [value]="t">{{ typeLabels[t] }}</option>
              }
            </select>
          </app-form-field>

          @if (type() === 'FLAT_RATE') {
            <app-form-field
              label="Price"
              [fieldId]="priceId"
              [error]="priceError()"
              [hint]="'Flat amount charged per shipment. ' + amountHint()"
              [required]="true"
              data-testid="method-price-block"
            >
              <app-input
                [id]="priceId"
                type="number"
                [step]="moneyStep()"
                formControlName="price"
                [invalid]="!!priceError()"
                [prefix]="moneyPrefix()"
                [suffix]="moneySuffix()"
                data-testid="method-price"
              />
            </app-form-field>
          }

          @if (type() === 'WEIGHT_BASED') {
            <fieldset
              class="flex flex-col gap-3"
              formArrayName="weightRanges"
              data-testid="method-weight-block"
            >
              <legend class="text-sm font-medium text-ink">Weight ranges</legend>
              <p class="text-xs text-ink-muted">At least one row required. Units in kilograms.</p>
              <div
                *ngFor="let g of weightRangeControls(); let i = index; trackBy: trackByIndex"
                class="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end"
                [formGroupName]="i"
              >
                <app-form-field label="Min kg" [fieldId]="'method-weight-' + i + '-min'">
                  <app-input
                    [id]="'method-weight-' + i + '-min'"
                    type="number"
                    [step]="WEIGHT_STEP"
                    formControlName="minKg"
                  />
                </app-form-field>
                <app-form-field label="Max kg" [fieldId]="'method-weight-' + i + '-max'">
                  <app-input
                    [id]="'method-weight-' + i + '-max'"
                    type="number"
                    [step]="WEIGHT_STEP"
                    formControlName="maxKg"
                  />
                </app-form-field>
                <app-form-field
                  label="Price"
                  [fieldId]="'method-weight-' + i + '-price'"
                  [hint]="amountHint()"
                >
                  <app-input
                    [id]="'method-weight-' + i + '-price'"
                    type="number"
                    [step]="moneyStep()"
                    formControlName="price"
                    [prefix]="moneyPrefix()"
                    [suffix]="moneySuffix()"
                  />
                </app-form-field>
                <app-button
                  variant="ghost"
                  size="sm"
                  type="button"
                  (clicked)="removeWeightRange(i)"
                  [ariaLabel]="'Remove range ' + (i + 1)"
                >
                  Remove
                </app-button>
              </div>
              <button
                type="button"
                (click)="addWeightRange()"
                class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface text-ink border border-ink hover:bg-surface-elevated px-3 py-2 text-xs min-h-[44px]"
                data-testid="method-weight-add"
              >
                Add weight range
              </button>
            </fieldset>
          }

          @if (type() === 'PRICE_BASED') {
            <fieldset
              class="flex flex-col gap-3"
              formArrayName="priceRanges"
              data-testid="method-price-range-block"
            >
              <legend class="text-sm font-medium text-ink">Price ranges</legend>
              <p class="text-xs text-ink-muted">At least one row required.</p>
              <div
                *ngFor="let g of priceRangeControls(); let i = index; trackBy: trackByIndex"
                class="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end"
                [formGroupName]="i"
              >
                <app-form-field label="Min amount" [fieldId]="'method-price-range-' + i + '-min'">
                  <app-input
                    [id]="'method-price-range-' + i + '-min'"
                    type="number"
                    [step]="moneyStep()"
                    formControlName="minAmount"
                    [prefix]="moneyPrefix()"
                    [suffix]="moneySuffix()"
                  />
                </app-form-field>
                <app-form-field label="Max amount" [fieldId]="'method-price-range-' + i + '-max'">
                  <app-input
                    [id]="'method-price-range-' + i + '-max'"
                    type="number"
                    [step]="moneyStep()"
                    formControlName="maxAmount"
                    [prefix]="moneyPrefix()"
                    [suffix]="moneySuffix()"
                  />
                </app-form-field>
                <app-form-field
                  label="Price"
                  [fieldId]="'method-price-range-' + i + '-price'"
                  [hint]="amountHint()"
                >
                  <app-input
                    [id]="'method-price-range-' + i + '-price'"
                    type="number"
                    [step]="moneyStep()"
                    formControlName="price"
                    [prefix]="moneyPrefix()"
                    [suffix]="moneySuffix()"
                  />
                </app-form-field>
                <app-button
                  variant="ghost"
                  size="sm"
                  type="button"
                  (clicked)="removePriceRange(i)"
                  [ariaLabel]="'Remove range ' + (i + 1)"
                >
                  Remove
                </app-button>
              </div>
              <button
                type="button"
                (click)="addPriceRange()"
                class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface text-ink border border-ink hover:bg-surface-elevated px-3 py-2 text-xs min-h-[44px]"
                data-testid="method-price-range-add"
              >
                Add price range
              </button>
            </fieldset>
          }

          <div class="grid gap-4 md:grid-cols-3">
            <app-form-field
              label="Free above"
              [fieldId]="freeAboveId"
              [hint]="'Optional threshold. ' + amountHint()"
            >
              <app-input
                [id]="freeAboveId"
                type="number"
                [step]="moneyStep()"
                formControlName="freeAbove"
                [prefix]="moneyPrefix()"
                [suffix]="moneySuffix()"
                data-testid="method-free-above"
              />
            </app-form-field>
            @if (type() !== 'FREE') {
              <app-form-field label="Min days" [fieldId]="daysMinId">
                <app-input [id]="daysMinId" type="number" formControlName="estimatedDaysMin" />
              </app-form-field>
              <app-form-field label="Max days" [fieldId]="daysMaxId">
                <app-input [id]="daysMaxId" type="number" formControlName="estimatedDaysMax" />
              </app-form-field>
            }
          </div>

          <div class="grid gap-4 md:grid-cols-2 items-start">
            <app-form-field label="Sort order" [fieldId]="sortId" hint="Integer ≥ 0.">
              <app-input
                [id]="sortId"
                type="number"
                formControlName="sortOrder"
                data-testid="method-sort"
              />
            </app-form-field>
            <div class="flex flex-col gap-3">
              <label class="inline-flex items-center gap-3 min-h-[44px] cursor-pointer">
                <input
                  type="checkbox"
                  formControlName="isActive"
                  class="h-5 w-5 border border-line bg-surface"
                  data-testid="method-isactive"
                />
                <span class="text-sm text-ink">Method is active</span>
              </label>
              <label class="inline-flex items-center gap-3 min-h-[44px] cursor-pointer">
                <input
                  type="checkbox"
                  formControlName="isDefault"
                  class="h-5 w-5 border border-line bg-surface"
                  data-testid="method-isdefault"
                />
                <span class="text-sm text-ink"> Preselected standard method for this zone </span>
              </label>
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            @if (isEditMode()) {
              <!-- form.dirty is read straight from the template: wrapping a
                   Reactive-Forms getter in computed() is untracked in this
                   zoneless app, so the memo would freeze on its first value. -->
              <p class="text-xs tabular text-ink-muted me-auto" data-testid="method-dirty">
                {{ form.dirty ? 'Unsaved changes' : 'No changes' }}
              </p>
            }
            <a
              routerLink="/shipping/methods"
              class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-5 py-3 text-sm min-h-[44px]"
              data-testid="method-cancel"
            >
              Cancel
            </a>
            <app-button
              type="submit"
              [disabled]="form.invalid || saving() || (isEditMode() && !form.dirty)"
              [loading]="saving()"
              data-testid="method-save"
            >
              {{ isEditMode() ? 'Save changes' : 'Create method' }}
            </app-button>
          </div>
        </form>
      }
    </section>
  `,
})
export class ShippingMethodEditorPage implements OnInit, OnDestroy {
  /**
   * The native `step`, driven by the store currency rather than hardcoded.
   * `step="0.01"` made the browser's own constraint validation reject a
   * millime before Angular ever saw the value, so an operator on a
   * three-decimal currency could not enter a legal price.
   */
  /**
   * Kilograms, not money. `ProductVariant.weight` and its siblings are
   * `Decimal(8, 3)`, so the step is a gram. It equals `moneyStep()` under XTS
   * and would silently diverge under any currency with a different scale, so
   * the source is the column rather than the coincidence.
   */
  protected readonly WEIGHT_STEP = 0.001;

  protected readonly moneyStep = computed(
    () => 1 / moneyScaleFactor(this.currencyStore.decimalPlaces()),
  );

  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly shipping = inject(ShippingService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly currencyStore = inject(CurrencyStore);

  /** Suffix for the money fields. Empty while the store currency is unknown. */
  protected readonly storeCode = this.currencyStore.code;
  /** The configured symbol and the side the store writes it on. */
  private readonly moneyAffix = inject(MoneyAffixStore);
  protected readonly moneyPrefix = this.moneyAffix.prefix;
  protected readonly moneySuffix = this.moneyAffix.suffix;

  /** The suffix is aria-hidden decoration; the hint is what screen readers get. */
  protected amountHint(): string {
    const code = this.storeCode();
    return code ? `Amount in ${code}.` : '';
  }
  private readonly destroy$ = new Subject<void>();

  readonly zoneId = 'method-zone';
  readonly nameId = 'method-name-default';
  readonly typeId = 'method-type';
  readonly priceId = 'method-price';
  readonly freeAboveId = 'method-free-above';
  readonly daysMinId = 'method-days-min';
  readonly daysMaxId = 'method-days-max';
  readonly sortId = 'method-sort';

  readonly editingId = signal<string | null>(null);
  readonly isEditMode = computed(() => this.editingId() !== null);
  readonly saving = signal(false);
  readonly loadingInitial = signal(false);
  readonly topError = signal<string | null>(null);
  readonly zones = signal<readonly ShippingZone[]>([]);
  readonly type = signal<ShippingMethodType>('FLAT_RATE');

  readonly typeOptions: readonly ShippingMethodType[] = [
    'FLAT_RATE',
    'WEIGHT_BASED',
    'PRICE_BASED',
    'FREE',
    'CARRIER_CALCULATED',
  ];
  readonly typeLabels = METHOD_TYPE_LABELS;

  readonly form = this.fb.group({
    zoneId: this.fb.nonNullable.control<string>('', [Validators.required]),
    name: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [translatableRequired]),
    type: this.fb.nonNullable.control<ShippingMethodType>('FLAT_RATE'),
    price: this.fb.control<number | null>(null, [Validators.min(0)]),
    freeAbove: this.fb.control<number | null>(null, [Validators.min(0)]),
    estimatedDaysMin: this.fb.control<number | null>(null, [Validators.min(0)]),
    estimatedDaysMax: this.fb.control<number | null>(null, [Validators.min(0)]),
    isActive: this.fb.nonNullable.control<boolean>(true),
    isDefault: this.fb.nonNullable.control<boolean>(false),
    sortOrder: this.fb.nonNullable.control<number>(0, [Validators.min(0)]),
    weightRanges: this.fb.array<FormGroup>([]),
    priceRanges: this.fb.array<FormGroup>([]),
  });

  get weightRanges(): FormArray {
    return this.form.controls.weightRanges;
  }
  get priceRanges(): FormArray {
    return this.form.controls.priceRanges;
  }

  /**
   * Zoneless + OnPush CD: Angular's `@for` block tracks array identity.
   * `weightRanges.controls` and `priceRanges.controls` return the same Array
   * instance after a `push()` / `removeAt()`, so the `@for` does not re-render
   * because it sees the same reference. The solution: writable signals that hold
   * a *new* array snapshot. Every mutation site calls the corresponding
   * `_syncXxxControls()` helper which calls `signal.set([...controls])`, giving
   * the `@for` expression a fresh reference to diff against.
   */
  readonly weightRangeControls = signal<FormGroup[]>([]);
  readonly priceRangeControls = signal<FormGroup[]>([]);

  trackByIndex(i: number): number {
    return i;
  }

  zoneName(z: ShippingZone): string {
    return typeof z.name?.default === 'string' ? z.name.default : '(untitled)';
  }

  zoneError(): string | null {
    const c = this.form.controls.zoneId;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('required')) return 'Zone is required.';
    return null;
  }

  nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('translatableRequired')) return 'Default-locale name is required.';
    return null;
  }

  priceError(): string | null {
    const c = this.form.controls.price;
    if (!c.touched && !c.dirty) return null;
    if (this.type() === 'FLAT_RATE') {
      const v = c.value;
      if (v === null || Number.isNaN(v)) return 'Flat-rate price is required.';
    }
    if (c.hasError('min')) return 'Price must be 0 or greater.';
    return null;
  }

  ngOnInit(): void {
    this.shipping
      .listZones({ pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.zones.set(res.data),
      });

    this.form.controls.type.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((t) => this.onTypeChange(t));

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.loadingInitial.set(true);
      this.shipping
        .listMethods({ pageSize: 100 })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            const match = res.data.find((m) => m.id === id);
            if (!match) {
              this.loadingInitial.set(false);
              this.topError.set('Method not found.');
              return;
            }
            this.populateForm(match);
            this.form.controls.zoneId.disable({ emitEvent: false });
            this.loadingInitial.set(false);
          },
          error: (err: unknown) => {
            this.loadingInitial.set(false);
            this.topError.set(this.formatError(err));
          },
        });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  addWeightRange(): void {
    this.weightRanges.push(this.buildWeightRange());
    this.form.markAsDirty();
    this.weightRangeControls.set([...this.weightRanges.controls] as FormGroup[]);
    this.cdr.detectChanges();
  }

  removeWeightRange(i: number): void {
    this.weightRanges.removeAt(i);
    this.form.markAsDirty();
    this.weightRangeControls.set([...this.weightRanges.controls] as FormGroup[]);
    this.cdr.detectChanges();
  }

  addPriceRange(): void {
    this.priceRanges.push(this.buildPriceRange());
    this.form.markAsDirty();
    this.priceRangeControls.set([...this.priceRanges.controls] as FormGroup[]);
    this.cdr.detectChanges();
  }

  removePriceRange(i: number): void {
    this.priceRanges.removeAt(i);
    this.form.markAsDirty();
    this.priceRangeControls.set([...this.priceRanges.controls] as FormGroup[]);
    this.cdr.detectChanges();
  }

  submit(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      queueMicrotask(() => this.focusFirstInvalid());
      return;
    }

    const t = this.type();
    if (t === 'WEIGHT_BASED' && this.weightRanges.length === 0) {
      this.topError.set('Weight-based methods require at least one range.');
      return;
    }
    if (t === 'PRICE_BASED' && this.priceRanges.length === 0) {
      this.topError.set('Price-based methods require at least one range.');
      return;
    }
    if (t === 'FLAT_RATE' && this.form.controls.price.value === null) {
      this.topError.set('Flat-rate methods require a price.');
      return;
    }

    this.saving.set(true);
    this.topError.set(null);
    const raw = this.form.getRawValue();

    const common = {
      name: raw.name,
      type: raw.type,
      isActive: raw.isActive,
      isDefault: raw.isDefault,
      sortOrder: Number(raw.sortOrder) || 0,
      ...(raw.freeAbove !== null && raw.freeAbove !== undefined
        ? { freeAbove: Number(raw.freeAbove) }
        : {}),
      ...(raw.estimatedDaysMin !== null && raw.estimatedDaysMin !== undefined
        ? { estimatedDaysMin: Number(raw.estimatedDaysMin) }
        : {}),
      ...(raw.estimatedDaysMax !== null && raw.estimatedDaysMax !== undefined
        ? { estimatedDaysMax: Number(raw.estimatedDaysMax) }
        : {}),
      ...(raw.type === 'FLAT_RATE' && raw.price !== null && raw.price !== undefined
        ? { price: Number(raw.price) }
        : {}),
      ...(raw.type === 'WEIGHT_BASED'
        ? {
            weightRanges: (
              raw.weightRanges as Array<{ minKg: number; maxKg: number; price: number }>
            ).map((r) => ({
              minKg: Number(r.minKg),
              maxKg: Number(r.maxKg),
              price: Number(r.price),
            })),
          }
        : {}),
      ...(raw.type === 'PRICE_BASED'
        ? {
            priceRanges: (
              raw.priceRanges as Array<{ minAmount: number; maxAmount: number; price: number }>
            ).map((r) => ({
              minAmount: Number(r.minAmount),
              maxAmount: Number(r.maxAmount),
              price: Number(r.price),
            })),
          }
        : {}),
    };

    const id = this.editingId();
    if (id) {
      const patch: UpdateShippingMethodRequest = common as UpdateShippingMethodRequest;
      this.shipping
        .updateMethod(id, patch)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.saving.set(false);
            void this.router.navigate(['/shipping/methods']);
          },
          error: (err: unknown) => {
            this.saving.set(false);
            this.topError.set(this.formatError(err));
          },
        });
      return;
    }

    const payload: CreateShippingMethodRequest = {
      zoneId: raw.zoneId,
      ...common,
    } as CreateShippingMethodRequest;
    this.shipping
      .createMethod(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.saving.set(false);
          void this.router.navigate(['/shipping/methods']);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.topError.set(this.formatError(err));
        },
      });
  }

  private focusFirstInvalid(): void {
    const order: Array<[string, AbstractControl]> = [
      [this.zoneId, this.form.controls.zoneId],
      [this.nameId, this.form.controls.name],
      [this.typeId, this.form.controls.type],
      [this.priceId, this.form.controls.price],
      [this.sortId, this.form.controls.sortOrder],
    ];
    for (const [id, control] of order) {
      if (control.invalid) {
        document.getElementById(id)?.focus();
        return;
      }
    }
  }

  private onTypeChange(t: ShippingMethodType): void {
    this.type.set(t);
    // Clear range arrays when the type switches away so the backend does not
    // receive stale config for the now-hidden repeater.
    if (t !== 'WEIGHT_BASED') {
      this.weightRanges.clear();
      this.weightRangeControls.set([]);
    }
    if (t !== 'PRICE_BASED') {
      this.priceRanges.clear();
      this.priceRangeControls.set([]);
    }
    if (t !== 'FLAT_RATE') this.form.controls.price.setValue(null);
    this.cdr.detectChanges();
  }

  private populateForm(m: ShippingMethod): void {
    this.form.patchValue({
      zoneId: m.zoneId,
      name: m.name,
      type: m.type,
      price: typeof m.price === 'number' ? m.price : null,
      freeAbove: typeof m.freeAbove === 'number' ? m.freeAbove : null,
      estimatedDaysMin: m.estimatedDaysMin ?? null,
      estimatedDaysMax: m.estimatedDaysMax ?? null,
      isActive: m.isActive,
      isDefault: m.isDefault ?? false,
      sortOrder: m.sortOrder,
    });
    this.type.set(m.type);
    this.weightRanges.clear();
    this.priceRanges.clear();
    if (Array.isArray(m.weightRanges)) {
      for (const r of m.weightRanges) {
        this.weightRanges.push(this.buildWeightRange(r.minKg, r.maxKg, r.price));
      }
    }
    if (Array.isArray(m.priceRanges)) {
      for (const r of m.priceRanges) {
        this.priceRanges.push(this.buildPriceRange(r.minAmount, r.maxAmount, r.price));
      }
    }
    this.weightRangeControls.set([...this.weightRanges.controls] as FormGroup[]);
    this.priceRangeControls.set([...this.priceRanges.controls] as FormGroup[]);
    this.cdr.detectChanges();
    this.form.markAsPristine();
  }

  private buildWeightRange(minKg = 0, maxKg = 0, price = 0): FormGroup {
    return this.fb.nonNullable.group({
      minKg: this.fb.nonNullable.control<number>(minKg, [Validators.min(0)]),
      maxKg: this.fb.nonNullable.control<number>(maxKg, [Validators.min(0)]),
      price: this.fb.nonNullable.control<number>(price, [Validators.min(0)]),
    });
  }

  private buildPriceRange(minAmount = 0, maxAmount = 0, price = 0): FormGroup {
    return this.fb.nonNullable.group({
      minAmount: this.fb.nonNullable.control<number>(minAmount, [Validators.min(0)]),
      maxAmount: this.fb.nonNullable.control<number>(maxAmount, [Validators.min(0)]),
      price: this.fb.nonNullable.control<number>(price, [Validators.min(0)]),
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to manage shipping methods.';
    if (err instanceof ApiNotFoundError) return 'Method not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save the method. Please retry.';
  }
}
