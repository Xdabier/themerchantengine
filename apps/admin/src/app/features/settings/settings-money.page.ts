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
import { RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent, SkeletonComponent } from '@admin-ui';
import {
  SettingsService,
  type SettingsResponse,
  type UpdateSettingsRequest,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  STORE_CONFIG_SYMBOL_POSITIONS,
  STORE_CONFIG_TAX_DISPLAYS,
} from '@common/store-config-fixtures/store-config-fixture.schema';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { CurrencyStore } from '../../core/stores/currency.store';
import { readSetting } from './settings.utils';

/** The engine's own ceiling: storage is Decimal(12, 3). */
const MAX_DECIMAL_PLACES = 3;

const TAX_DISPLAY_LABELS: Record<string, string> = {
  HT: 'Before tax (HT)',
  TTC: 'Tax included (TTC)',
  none: 'No tax mention',
};

const SYMBOL_POSITION_LABELS: Record<string, string> = {
  before: 'Before the number',
  after: 'After the number',
};

/**
 * `/settings/money` — how the store writes an amount.
 *
 * The currency itself is chosen at `/currencies`, which is the single editor
 * for which currencies the store accepts and which one it prices in. This
 * screen owns the format: the symbol and the side it sits on, the separators,
 * how many fraction digits are displayed, and whether catalogue prices carry a
 * tax mention.
 *
 * Display precision lives in `localization.currencyConfig.decimalPlaces`, not
 * in the money group, which is the E1 deviation the plan records. It is edited
 * here anyway, because an operator setting a money format does not care which
 * settings group a key was filed under.
 */
@Component({
  selector: 'app-settings-money-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl" data-testid="settings-money-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/settings"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Settings
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Money</span>
      </nav>

      <header>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight">Money</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          How every amount is written on the storefront and in the admin. Which currency the store
          prices in is chosen under
          <a
            routerLink="/currencies"
            class="text-ink underline underline-offset-4 hover:text-ink-emphasis focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            data-testid="settings-money-currency-link"
          >
            Currencies</a
          >.
        </p>
      </header>

      <div role="status" aria-live="polite" data-testid="settings-money-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">{{ error() }}</p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="settings-money-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">Money saved.</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="12rem" width="100%" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-6" novalidate>
          <div
            class="border border-line p-4 flex flex-col gap-1"
            data-testid="settings-money-sample"
          >
            <p class="text-xs tracking-widest uppercase text-ink-muted">Sample</p>
            <p class="tabular text-2xl text-ink" data-testid="settings-money-sample-value">
              {{ sample() }}
            </p>
          </div>

          <fieldset class="flex flex-col gap-5" data-testid="settings-money-currency">
            <legend class="text-xs tracking-widest uppercase text-ink-muted">Currency</legend>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div class="flex flex-col gap-2">
                <span class="text-xs tracking-widest uppercase text-ink-muted">Code</span>
                <p class="tabular text-sm text-ink" data-testid="settings-money-code">
                  {{ storeCode() ?? 'Not set' }}
                </p>
              </div>

              <app-form-field
                label="Symbol"
                fieldId="money-symbol"
                hint="Shown beside an amount on the storefront. Empty falls back to the code."
              >
                <app-input
                  id="money-symbol"
                  type="text"
                  formControlName="symbol"
                  data-testid="settings-money-symbol"
                ></app-input>
              </app-form-field>
            </div>

            <div class="flex flex-col gap-2">
              <label
                for="money-symbol-position"
                class="text-xs tracking-widest uppercase text-ink-muted"
              >
                Symbol position
              </label>
              <select
                id="money-symbol-position"
                formControlName="symbolPosition"
                class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                data-testid="settings-money-symbol-position"
              >
                @for (position of symbolPositions; track position) {
                  <option [value]="position">{{ positionLabel(position) }}</option>
                }
              </select>
            </div>
          </fieldset>

          <fieldset class="flex flex-col gap-5" data-testid="settings-money-format">
            <legend class="text-xs tracking-widest uppercase text-ink-muted">Number format</legend>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
              <app-form-field
                label="Decimal separator"
                fieldId="money-decimal-separator"
                [error]="separatorError()"
              >
                <app-input
                  id="money-decimal-separator"
                  type="text"
                  formControlName="decimalSeparator"
                  [invalid]="!!separatorError()"
                  data-testid="settings-money-decimal-separator"
                ></app-input>
              </app-form-field>

              <app-form-field
                label="Thousands separator"
                fieldId="money-thousands-separator"
                [error]="separatorError()"
              >
                <app-input
                  id="money-thousands-separator"
                  type="text"
                  formControlName="thousandsSeparator"
                  [invalid]="!!separatorError()"
                  data-testid="settings-money-thousands-separator"
                ></app-input>
              </app-form-field>

              <app-form-field
                label="Display precision"
                fieldId="money-decimal-places"
                [error]="decimalPlacesError()"
                hint="Fraction digits, 0 to 3."
              >
                <app-input
                  id="money-decimal-places"
                  type="number"
                  min="0"
                  step="1"
                  formControlName="decimalPlaces"
                  [invalid]="!!decimalPlacesError()"
                  data-testid="settings-money-decimal-places"
                ></app-input>
              </app-form-field>
            </div>
          </fieldset>

          <fieldset class="flex flex-col gap-5" data-testid="settings-money-tax">
            <legend class="text-xs tracking-widest uppercase text-ink-muted">Tax</legend>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div class="flex flex-col gap-2">
                <label
                  for="money-tax-display"
                  class="text-xs tracking-widest uppercase text-ink-muted"
                >
                  Tax mention on prices
                </label>
                <select
                  id="money-tax-display"
                  formControlName="taxDisplay"
                  class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  data-testid="settings-money-tax-display"
                >
                  @for (display of taxDisplays; track display) {
                    <option [value]="display">{{ taxDisplayLabel(display) }}</option>
                  }
                </select>
              </div>

              <app-form-field
                label="VAT rate"
                fieldId="money-vat-rate"
                [error]="vatRateError()"
                hint="A fraction, not a percentage: 0.19 means 19 percent. Zero means no VAT."
              >
                <app-input
                  id="money-vat-rate"
                  type="number"
                  min="0"
                  step="0.0001"
                  formControlName="vatRate"
                  [invalid]="!!vatRateError()"
                  data-testid="settings-money-vat-rate"
                ></app-input>
              </app-form-field>
            </div>
          </fieldset>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
          >
            <p class="text-xs tabular text-ink-muted">
              {{ form.dirty ? 'Unsaved changes' : 'No changes' }}
            </p>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy() || !form.dirty"
                (clicked)="revert()"
                data-testid="settings-money-revert"
              >
                Revert
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || !form.dirty || !canManage()"
                [loading]="busy()"
                data-testid="settings-money-save"
              >
                Save
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class SettingsMoneyPage implements OnInit, OnDestroy {
  private readonly service = inject(SettingsService);
  private readonly authStore = inject(AuthStore);
  private readonly currencyStore = inject(CurrencyStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly current = signal<SettingsResponse | null>(null);

  /** Read-only here: `/currencies` is the single editor for the code (DR-26). */
  protected readonly storeCode = this.currencyStore.code;

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  protected readonly symbolPositions: readonly string[] = STORE_CONFIG_SYMBOL_POSITIONS;
  protected readonly taxDisplays: readonly string[] = STORE_CONFIG_TAX_DISPLAYS;

  readonly form = this.fb.nonNullable.group({
    symbol: this.fb.nonNullable.control('', [Validators.maxLength(8)]),
    symbolPosition: this.fb.nonNullable.control<string>(STORE_CONFIG_SYMBOL_POSITIONS[0]),
    decimalSeparator: this.fb.nonNullable.control('.', [Validators.maxLength(1)]),
    thousandsSeparator: this.fb.nonNullable.control(',', [Validators.maxLength(1)]),
    decimalPlaces: this.fb.nonNullable.control(2),
    taxDisplay: this.fb.nonNullable.control<string>('none'),
    vatRate: this.fb.nonNullable.control(0),
  });

  /**
   * A live sample of the format, rebuilt from the form on every change.
   *
   * A signal fed by `valueChanges`, not a computed over the control getters:
   * those are untracked, so a computed memoizes its first read forever.
   */
  private readonly _sample = signal('');
  readonly sample = this._sample.asReadonly();

  ngOnInit(): void {
    this.form.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => this.renderSample());
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  separatorError(): string | null {
    const decimal = this.form.controls.decimalSeparator;
    const thousands = this.form.controls.thousandsSeparator;
    if (!decimal.touched && !thousands.touched) return null;
    if (decimal.value.length !== 1 || thousands.value.length !== 1) {
      return 'Each separator is exactly one character.';
    }
    // The storefront config refuses the pair outright, and a number written
    // with the same character in both roles cannot be read back.
    if (decimal.value === thousands.value) return 'The two separators must differ.';
    return null;
  }

  decimalPlacesError(): string | null {
    const c = this.form.controls.decimalPlaces;
    if (!c.touched) return null;
    const value = Number(c.value);
    if (!Number.isInteger(value) || value < 0 || value > MAX_DECIMAL_PLACES) {
      return `A whole number from 0 to ${MAX_DECIMAL_PLACES}.`;
    }
    return null;
  }

  vatRateError(): string | null {
    const c = this.form.controls.vatRate;
    if (!c.touched) return null;
    const value = Number(c.value);
    if (Number.isNaN(value) || value < 0 || value > 1) {
      return 'A fraction from 0 to 1, e.g. 0.19 for 19 percent.';
    }
    if (Math.round(value * 1e4) !== value * 1e4) return 'At most four decimal places.';
    return null;
  }

  revert(): void {
    const settings = this.current();
    if (settings) this.seedForm(settings);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.form.dirty) return;
    if (this.separatorError() || this.decimalPlacesError() || this.vatRateError()) return;

    const raw = this.form.getRawValue();
    const body: UpdateSettingsRequest = {};
    if (this.form.controls.symbolPosition.dirty) {
      body.symbolPosition = raw.symbolPosition as UpdateSettingsRequest['symbolPosition'];
    }
    if (this.form.controls.decimalSeparator.dirty) body.decimalSeparator = raw.decimalSeparator;
    if (this.form.controls.thousandsSeparator.dirty) {
      body.thousandsSeparator = raw.thousandsSeparator;
    }
    if (this.form.controls.taxDisplay.dirty) {
      body.taxDisplay = raw.taxDisplay as UpdateSettingsRequest['taxDisplay'];
    }
    if (this.form.controls.vatRate.dirty) body.vatRate = Number(raw.vatRate);
    // The symbol and the precision are two keys of one stored object, and the
    // API replaces that object wholesale, so a change to either sends both
    // along with the code the currencies screen owns.
    if (this.form.controls.symbol.dirty || this.form.controls.decimalPlaces.dirty) {
      const code = this.storeCode();
      if (code) {
        body.currencyConfig = {
          code,
          symbol: raw.symbol.trim(),
          decimalPlaces: Number(raw.decimalPlaces),
        };
      }
    }

    this.busy.set(true);
    this.error.set(null);
    this.service.update(body).subscribe({
      next: (next) => {
        this.busy.set(false);
        this.current.set(next);
        this.seedForm(next);
        // Every money surface in the admin reads the currency config through
        // this store, so a save that does not refresh it leaves the dashboard
        // formatting against the previous one until a full reload.
        this.currencyStore.refresh();
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save money settings.'));
      },
    });
  }

  taxDisplayLabel(display: string): string {
    return TAX_DISPLAY_LABELS[display] ?? display;
  }

  positionLabel(position: string): string {
    return SYMBOL_POSITION_LABELS[position] ?? position;
  }

  private renderSample(): void {
    const raw = this.form.getRawValue();
    const places = Math.min(Math.max(Number(raw.decimalPlaces) || 0, 0), MAX_DECIMAL_PLACES);
    const amount = 1234567.891;
    const [whole, fraction = ''] = amount.toFixed(places).split('.');
    const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, raw.thousandsSeparator || '');
    const number = fraction ? `${grouped}${raw.decimalSeparator}${fraction}` : grouped;
    const unit = raw.symbol.trim() || this.storeCode() || '';
    const withUnit = !unit
      ? number
      : raw.symbolPosition === 'before'
        ? `${unit} ${number}`
        : `${number} ${unit}`;
    const tax = raw.taxDisplay === 'none' ? '' : ` ${raw.taxDisplay}`;
    this._sample.set(`${withUnit}${tax}`);
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .getAll()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (settings) => {
          this.current.set(settings);
          this.seedForm(settings);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(settings: SettingsResponse): void {
    const currencyConfig = readSetting<Record<string, unknown>>(
      settings,
      'localization',
      'currencyConfig',
      {},
    );
    const symbol = currencyConfig?.['symbol'];
    const places = currencyConfig?.['decimalPlaces'];
    this.form.reset(
      {
        symbol: typeof symbol === 'string' ? symbol : '',
        symbolPosition: readSetting<string>(
          settings,
          'money',
          'symbolPosition',
          STORE_CONFIG_SYMBOL_POSITIONS[0],
        ),
        decimalSeparator: readSetting<string>(settings, 'money', 'decimalSeparator', '.'),
        thousandsSeparator: readSetting<string>(settings, 'money', 'thousandsSeparator', ','),
        decimalPlaces: typeof places === 'number' ? places : 2,
        taxDisplay: readSetting<string>(settings, 'money', 'taxDisplay', 'none'),
        vatRate: readSetting<number>(settings, 'money', 'vatRate', 0),
      },
      { emitEvent: false },
    );
    this.renderSample();
  }

  private formatError(err: unknown, fallback = 'Could not load money settings.'): string {
    if (err instanceof ApiForbiddenError) {
      return 'You do not have permission to manage money settings.';
    }
    if (err instanceof ApiNotFoundError) return 'Money settings not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
