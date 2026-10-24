import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  openConfirmDialog,
} from '@admin-ui';
import { PromotionsService, type Promotion, type UpdatePromotionRequest } from '@admin-services';
import {
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  moneyScaleFactor,
} from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { PromotionScopeEditorComponent } from './promotion-scope.component';
import {
  formatDateRange,
  formatPromotionDiscount,
  promotionLabel,
  promotionStatus,
  promotionStatusTone,
  promotionTypeLabel,
} from './promotions.utils';
import { CurrencyStore } from '../../core/stores/currency.store';
import { MoneyAffixStore } from '../../core/stores/money-affix.store';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/promotions/:id` — read + edit a single promotion.
 *
 * The backend surfaces most promotion fields as nullable — which means
 * the reactive form has to handle "null vs empty string" on every
 * non-required field. We normalise on both ends:
 *   - `seedForm` turns nullable values into empty strings / false.
 *   - `save()` diffs against the loaded `current` row and only ships
 *     the dirty keys (so untouched fields never clobber server state).
 */
@Component({
  selector: 'app-promotion-detail-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    PromotionScopeEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="promotion-detail-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/promotions"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Promotions
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">
          {{ current() ? label(current()!) : '…' }}
        </span>
      </nav>

      <div role="status" aria-live="polite" data-testid="promotion-detail-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="12rem" width="100%" />
        </div>
      } @else if (current(); as p) {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">
              {{ typeLabel(p.type) }}
              @if (p.applicationMethod === 'AUTOMATIC') {
                · Automatic
              } @else {
                · Coupon
              }
            </p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight truncate">
              {{ label(p) }}
            </h1>
            @if (p.couponCode) {
              <p class="mt-3 tabular text-sm text-ink-muted">
                Coupon <code class="font-mono text-ink">{{ p.couponCode }}</code>
              </p>
            }
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <app-badge
              [tone]="statusTone(computedStatus(p))"
              [ariaLabel]="'Status: ' + computedStatus(p)"
            >
              {{ computedStatus(p) }}
            </app-badge>
            <app-badge tone="neutral" [ariaLabel]="'Discount: ' + discount(p)">
              {{ discount(p) }}
            </app-badge>
            <span aria-live="polite" aria-atomic="true" class="inline-flex">
              @if (saved()) {
                <app-badge tone="success" [ariaLabel]="'Changes saved'">Saved</app-badge>
              }
            </span>
          </div>
        </header>

        <dl
          class="grid grid-cols-1 md:grid-cols-3 gap-6 border border-line p-5"
          aria-label="Promotion summary"
        >
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Window</dt>
            <dd class="mt-1 tabular text-sm text-ink">
              {{ dateRange(p.startsAt, p.endsAt) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Usage</dt>
            <dd class="mt-1 tabular text-sm text-ink">
              {{ p.usageCount ?? 0 }}
              @if (p.usageLimit) {
                / {{ p.usageLimit }}
              } @else {
                / ∞
              }
              @if (p.usageLimitPerUser) {
                <span class="text-ink-muted ml-2">({{ p.usageLimitPerUser }} per customer)</span>
              }
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Scope</dt>
            <dd class="mt-1 tabular text-sm text-ink">
              @if (scope(p); as s) {
                {{ s }}
              } @else {
                All products
              }
            </dd>
          </div>
        </dl>

        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          <app-form-field
            label="Coupon code"
            fieldId="promo-code"
            hint="Leave empty for automatic promotions."
          >
            <app-input id="promo-code" type="text" formControlName="couponCode"></app-input>
          </app-form-field>

          <app-form-field
            label="Discount value"
            fieldId="promo-value"
            [required]="true"
            [hint]="valueHint()"
          >
            <app-input
              id="promo-value"
              type="number"
              [step]="valueStep()"
              formControlName="value"
              [invalid]="form.controls.value.touched && form.controls.value.invalid"
              [prefix]="valuePrefix()"
              [suffix]="valueSuffix()"
            ></app-input>
          </app-form-field>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field label="Minimum order" fieldId="promo-min" [hint]="amountHint()">
              <app-input
                id="promo-min"
                type="number"
                [step]="moneyStep()"
                formControlName="minimumOrderAmount"
                [prefix]="moneyPrefix()"
                [suffix]="moneySuffix()"
              ></app-input>
            </app-form-field>
            <app-form-field label="Maximum discount" fieldId="promo-max">
              <app-input
                id="promo-max"
                type="number"
                [step]="moneyStep()"
                formControlName="maximumDiscount"
                [prefix]="moneyPrefix()"
                [suffix]="moneySuffix()"
              ></app-input>
            </app-form-field>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field label="Total usage cap" fieldId="promo-usage">
              <app-input id="promo-usage" type="number" formControlName="usageLimit"></app-input>
            </app-form-field>
            <app-form-field label="Per-customer cap" fieldId="promo-usage-per">
              <app-input
                id="promo-usage-per"
                type="number"
                formControlName="usageLimitPerUser"
              ></app-input>
            </app-form-field>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field label="Starts at" fieldId="promo-starts">
              <app-input
                id="promo-starts"
                type="datetime-local"
                formControlName="startsAt"
              ></app-input>
            </app-form-field>
            <app-form-field label="Ends at" fieldId="promo-ends">
              <app-input id="promo-ends" type="datetime-local" formControlName="endsAt"></app-input>
            </app-form-field>
          </div>

          <div class="flex flex-wrap items-center gap-6">
            <label class="inline-flex items-center gap-3 text-sm tabular">
              <input
                type="checkbox"
                formControlName="isActive"
                class="h-4 w-4 accent-ink"
                data-testid="promo-active"
              />
              Active
            </label>
            <label class="inline-flex items-center gap-3 text-sm tabular">
              <input
                type="checkbox"
                formControlName="isExclusive"
                class="h-4 w-4 accent-ink"
                data-testid="promo-exclusive"
              />
              Exclusive (does not stack)
            </label>
          </div>

          <app-promotion-scope-editor
            [initialProductIds]="initialProductIds()"
            [initialCategoryIds]="initialCategoryIds()"
            (changed)="onScopeChanged($event)"
          ></app-promotion-scope-editor>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex flex-wrap items-center justify-between gap-3"
          >
            <div class="flex items-center gap-3">
              @if (canDeactivate() && p.isActive) {
                <app-button
                  type="button"
                  variant="destructive"
                  size="sm"
                  [disabled]="busy()"
                  [loading]="busy() && action() === 'deactivate'"
                  (clicked)="confirmDeactivate()"
                  data-testid="promo-deactivate"
                >
                  Deactivate
                </app-button>
              }
              <p class="text-xs tabular text-ink-muted">
                {{ form.dirty || scopeDirty() ? 'Unsaved changes' : 'No changes' }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy()"
                routerLink="/promotions"
                data-testid="promo-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || (!form.dirty && !scopeDirty())"
                [loading]="busy() && action() === 'save'"
                data-testid="promo-save"
              >
                Save changes
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class PromotionDetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(PromotionsService);
  private readonly authStore = inject(AuthStore);
  private readonly currencyStore = inject(CurrencyStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  /**
   * Suffix and hint for the money fields. Only FIXED_AMOUNT is money, so the
   * value field carries `%` or the store code depending on the promotion type.
   */
  protected readonly storeCode = this.currencyStore.code;
  /** The configured symbol and the side the store writes it on. */
  private readonly moneyAffix = inject(MoneyAffixStore);
  protected readonly moneyPrefix = this.moneyAffix.prefix;
  protected readonly moneySuffix = this.moneyAffix.suffix;

  /**
   * Step the money fields by the store currency's own scale. The atom defaulted
   * to `step=1`, so under a three-decimal currency a legal price could not be
   * typed at all.
   */
  protected readonly moneyStep = computed(
    () => 1 / moneyScaleFactor(this.currencyStore.decimalPlaces()),
  );

  /**
   * `value` is a percentage for PERCENTAGE promotions and an amount otherwise,
   * which is why `valueSuffix()` above already branches on the same thing.
   * Stepping a percentage by a millime would be wrong, so this follows the
   * type rather than assuming money.
   */
  protected valueStep(): number {
    return this.current()?.type === 'PERCENTAGE' ? 0.01 : this.moneyStep();
  }

  /**
   * A percentage is written after the number whatever the store's money format
   * says, because the rule is about a currency symbol and this is not one.
   */
  protected valueSuffix(): string | null {
    const type = this.current()?.type;
    if (type === 'PERCENTAGE') return '%';
    if (type === 'FIXED_AMOUNT') return this.moneySuffix();
    return null;
  }

  protected valuePrefix(): string | null {
    return this.current()?.type === 'FIXED_AMOUNT' ? this.moneyPrefix() : null;
  }

  protected valueHint(): string {
    const type = this.current()?.type;
    if (type === 'PERCENTAGE') return 'Percent off, 0 to 100.';
    if (type === 'FIXED_AMOUNT') return this.amountHint();
    return 'The backend scopes this value to the promotion type.';
  }

  protected amountHint(): string {
    const code = this.storeCode();
    return code ? `Amount in ${code}.` : '';
  }
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<Promotion | null>(null);
  readonly busy = signal(false);
  readonly action = signal<'save' | 'deactivate' | null>(null);
  readonly saved = signal(false);

  /** Tracks whether the scope editor has diverged from the loaded row so
   *  the Save button tracks form dirtiness + scope dirtiness independently. */
  readonly scopeDirty = signal(false);
  private pendingProductIds: string[] = [];
  private pendingCategoryIds: string[] = [];

  readonly initialProductIds = computed<readonly string[]>(
    () => this.current()?.eligibleProducts?.map((r) => r.productId) ?? [],
  );
  readonly initialCategoryIds = computed<readonly string[]>(
    () => this.current()?.eligibleCategories?.map((r) => r.categoryId) ?? [],
  );

  readonly canDeactivate = computed(() =>
    this.authStore.hasAnyPermission(['promotions:delete', 'promotions:manage']),
  );

  protected readonly label = (p: Pick<Promotion, 'name'>): string =>
    promotionLabel(p, this.authStore.locale(), this.storeSettings.defaultLocale());
  protected readonly typeLabel = promotionTypeLabel;
  protected readonly discount = (p: Promotion) =>
    formatPromotionDiscount(p, this.currencyStore.config());
  /**
   * A plain method, not a computed: per the project's zoneless rule a template
   * helper reads the store signal on every pass so a late settings hydration
   * re-renders the window.
   */
  protected dateRange(start?: string | null, end?: string | null): string {
    return formatDateRange(start, end, this.storeSettings.timezone());
  }
  protected readonly statusTone = promotionStatusTone;
  protected readonly computedStatus = promotionStatus;

  readonly form = this.fb.nonNullable.group({
    couponCode: this.fb.nonNullable.control(''),
    value: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0)]),
    // `number | null`, not a string. These four are optional caps, and the
    // number input reports `null` for a cleared field rather than the empty
    // string the round-trip through `String()` used to produce. Holding them
    // as strings meant a cleared cap read as `Number(null)`, which is 0, and
    // 0 fails the request schema's `positive()` inside a synchronous parse
    // that escapes the save handler after `busy` is already set.
    minimumOrderAmount: this.fb.control<number | null>(null),
    maximumDiscount: this.fb.control<number | null>(null),
    usageLimit: this.fb.control<number | null>(null),
    usageLimitPerUser: this.fb.control<number | null>(null),
    startsAt: this.fb.nonNullable.control(''),
    endsAt: this.fb.nonNullable.control(''),
    isActive: this.fb.nonNullable.control(true),
    isExclusive: this.fb.nonNullable.control(false),
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((p) => {
      const id = p.get('id');
      if (id) this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  scope(p: Promotion): string | null {
    const prod = p.eligibleProducts?.length ?? 0;
    const cat = p.eligibleCategories?.length ?? 0;
    if (prod === 0 && cat === 0) return null;
    const parts: string[] = [];
    if (prod > 0) parts.push(`${prod} product(s)`);
    if (cat > 0) parts.push(`${cat} category(ies)`);
    return parts.join(' · ');
  }

  onScopeChanged(change: { productIds: string[]; categoryIds: string[] }): void {
    const initialProducts = [...this.initialProductIds()].sort();
    const initialCategories = [...this.initialCategoryIds()].sort();
    const nextProducts = [...change.productIds].sort();
    const nextCategories = [...change.categoryIds].sort();
    const productsDiff =
      nextProducts.length !== initialProducts.length ||
      nextProducts.some((id, i) => id !== initialProducts[i]);
    const categoriesDiff =
      nextCategories.length !== initialCategories.length ||
      nextCategories.some((id, i) => id !== initialCategories[i]);
    this.pendingProductIds = change.productIds;
    this.pendingCategoryIds = change.categoryIds;
    this.scopeDirty.set(productsDiff || categoriesDiff);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    if (!this.form.dirty && !this.scopeDirty()) return;

    const raw = this.form.getRawValue();
    const dirty = this.form.controls;
    const body: UpdatePromotionRequest = {};

    if (dirty.couponCode.dirty) body.couponCode = raw.couponCode || undefined;
    if (dirty.value.dirty) body.value = Number(raw.value);
    // `?? undefined`, so a cleared cap omits the key rather than sending 0.
    if (dirty.minimumOrderAmount.dirty)
      body.minimumOrderAmount = raw.minimumOrderAmount ?? undefined;
    if (dirty.maximumDiscount.dirty) body.maximumDiscount = raw.maximumDiscount ?? undefined;
    if (dirty.usageLimit.dirty) body.usageLimit = raw.usageLimit ?? undefined;
    if (dirty.usageLimitPerUser.dirty) body.usageLimitPerUser = raw.usageLimitPerUser ?? undefined;
    if (dirty.startsAt.dirty)
      body.startsAt = raw.startsAt ? new Date(raw.startsAt).toISOString() : undefined;
    if (dirty.endsAt.dirty)
      body.endsAt = raw.endsAt ? new Date(raw.endsAt).toISOString() : undefined;
    if (dirty.isActive.dirty) body.isActive = raw.isActive;
    if (dirty.isExclusive.dirty) body.isExclusive = raw.isExclusive;
    if (this.scopeDirty()) {
      body.eligibleProductIds = this.pendingProductIds;
      body.eligibleCategoryIds = this.pendingCategoryIds;
    }

    this.startAction('save');
    this.service.update(this.current()!.id, body).subscribe({
      next: (updated) => {
        this.current.set(updated);
        this.form.markAsPristine();
        this.scopeDirty.set(false);
        this.pendingProductIds = [];
        this.pendingCategoryIds = [];
        this.busy.set(false);
        this.action.set(null);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => this.failAction(err, 'Could not save promotion.'),
    });
  }

  async confirmDeactivate(): Promise<void> {
    const current = this.current();
    if (!current || this.busy()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Deactivate this promotion?',
      body: 'The promotion will stop applying immediately. You can reactivate it later by flipping the Active toggle.',
      confirmLabel: 'Deactivate',
      tone: 'destructive',
    });
    if (!ok) return;

    this.startAction('deactivate');
    this.service.deactivate(current.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.action.set(null);
        void this.router.navigate(['/promotions']);
      },
      error: (err: unknown) => this.failAction(err, 'Could not deactivate promotion.'),
    });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .get(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (p) => {
          this.current.set(p);
          this.seedForm(p);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(p: Promotion): void {
    const toLocal = (iso?: string | null): string => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      // `datetime-local` expects `YYYY-MM-DDTHH:mm` without seconds / tz.
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    this.form.reset(
      {
        couponCode: p.couponCode ?? '',
        value: Number(p.value),
        minimumOrderAmount: p.minimumOrderAmount ?? null,
        maximumDiscount: p.maximumDiscount ?? null,
        usageLimit: p.usageLimit ?? null,
        usageLimitPerUser: p.usageLimitPerUser ?? null,
        startsAt: toLocal(p.startsAt),
        endsAt: toLocal(p.endsAt),
        isActive: p.isActive,
        isExclusive: p.isExclusive ?? false,
      },
      { emitEvent: false },
    );
  }

  private startAction(kind: 'save' | 'deactivate'): void {
    this.busy.set(true);
    this.action.set(kind);
    this.error.set(null);
    this.saved.set(false);
  }

  private failAction(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.action.set(null);
    this.error.set(this.formatError(err, fallback));
  }

  private formatError(err: unknown, fallback = 'Could not load promotion.'): string {
    // HTTP errors arrive as ApiError subclasses from errorNormalizerInterceptor —
    // never as raw HttpErrorResponse. Check the typed hierarchy.
    if (err instanceof ApiNotFoundError) return 'Promotion not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to modify promotions.';
    if (err instanceof ApiConflictError) return 'Coupon code conflict — pick a different code.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
