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
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
} from '@admin-ui';
import { TaxService, type TaxZone, type UpdateTaxZoneRequest } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../../core/stores/auth.store';
import { TranslatablePipe } from '../../../shared/pipes/translatable.pipe';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../../core/stores/store-settings.store';

/**
 * `/shipping/tax/:id` — inline tax-zone editor.
 *
 * Rate is entered as a percent (0–100) for operator readability and
 * converted back to the 0..1 fraction the backend expects. Countries
 * are edited as a comma-separated ISO2 list — a full country picker
 * is overkill for tax zones that typically list 1–5 codes.
 */
@Component({
  selector: 'app-tax-zone-editor-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatablePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="tax-zone-editor-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/shipping/tax"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Tax zones
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">{{ current()?.name | translatable: '…' }}</span>
      </nav>

      <div role="alert" aria-atomic="true" data-testid="tax-zone-editor-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="3rem" width="40%" />
          <app-skeleton height="10rem" width="100%" />
        </div>
      } @else if (current(); as z) {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">Tax zone</p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight truncate">
              {{ z.name | translatable }}
            </h1>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            @if (z.isDefault) {
              <app-badge tone="info" [ariaLabel]="'Default zone'">Default</app-badge>
            }
            <span aria-live="polite" class="inline-flex">
              @if (saved()) {
                <app-badge tone="success" [ariaLabel]="'Changes saved'">Saved</app-badge>
              }
            </span>
          </div>
        </header>

        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          <app-form-field label="Name" fieldId="tax-name" [required]="true">
            <app-input id="tax-name" type="text" formControlName="name"></app-input>
          </app-form-field>

          <app-form-field
            label="Rate (%)"
            fieldId="tax-rate"
            [required]="true"
            [error]="rateError()"
            hint="Percent between 0 and 100. Stored as the decimal fraction on the backend."
          >
            <app-input
              id="tax-rate"
              type="number"
              formControlName="ratePercent"
              [invalid]="!!rateError()"
              inputmode="decimal"
            ></app-input>
          </app-form-field>

          <app-form-field
            label="Countries"
            fieldId="tax-countries"
            [required]="true"
            [error]="countriesError()"
            hint="ISO 3166-1 alpha-2 codes, comma-separated (e.g. QA, AE, SA)."
          >
            <app-input
              id="tax-countries"
              type="text"
              formControlName="countries"
              [invalid]="!!countriesError()"
            ></app-input>
          </app-form-field>

          <app-form-field label="Priority" fieldId="tax-priority" hint="Lower first on ties.">
            <app-input id="tax-priority" type="number" formControlName="priority"></app-input>
          </app-form-field>

          <div class="flex flex-wrap items-center gap-6">
            <label class="inline-flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                formControlName="isDefault"
                class="h-4 w-4 accent-ink"
                data-testid="tax-default"
              />
              Default (fallback for uncovered countries)
            </label>
            <label class="inline-flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                formControlName="isCompound"
                class="h-4 w-4 accent-ink"
                data-testid="tax-compound"
              />
              Compound (applies on top of other taxes)
            </label>
            <label class="inline-flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                formControlName="isActive"
                class="h-4 w-4 accent-ink"
                data-testid="tax-active"
              />
              Active
            </label>
          </div>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
          >
            <p class="text-xs text-ink-muted" role="status" aria-live="polite" aria-atomic="true">
              {{ form.dirty ? 'Unsaved changes' : 'No changes' }}
            </p>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy()"
                routerLink="/shipping/tax"
                data-testid="tax-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || !form.dirty || !canManage()"
                [loading]="busy()"
                data-testid="tax-save"
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
export class TaxZoneEditorPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly tax = inject(TaxService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<TaxZone | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(100)]),
    ratePercent: this.fb.nonNullable.control(0, [
      Validators.required,
      Validators.min(0),
      Validators.max(100),
    ]),
    // Countries is optional on PATCH (UpdateTaxZoneAdminDto = PartialType of Create).
    // The default zone legitimately has countries:[] — do not block the form with required.
    // countriesError() guards against invalid codes when the field IS changed.
    countries: this.fb.nonNullable.control(''),
    priority: this.fb.nonNullable.control(0, [Validators.min(0)]),
    isDefault: this.fb.nonNullable.control(false),
    isCompound: this.fb.nonNullable.control(false),
    isActive: this.fb.nonNullable.control(true),
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

  rateError(): string | null {
    const c = this.form.controls.ratePercent;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Rate is required.';
    if (c.hasError('min') || c.hasError('max')) return 'Rate must be between 0 and 100.';
    return null;
  }

  countriesError(): string | null {
    const c = this.form.controls.countries;
    if (!c.touched) return null;
    const tokens = this.parseCountries(c.value);
    if (tokens.length === 0) return 'Enter at least one ISO 3166-1 alpha-2 code.';
    const bad = tokens.find((t) => !/^[A-Z]{2}$/.test(t));
    if (bad) return `"${bad}" is not a valid ISO alpha-2 code.`;
    return null;
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.form.dirty) return;
    // Only validate countries format when the user actually changed the field.
    // Zones with countries:[] (e.g. the default fallback zone) must still be editable.
    if (this.form.controls.countries.dirty && this.countriesError()) return;

    const raw = this.form.getRawValue();
    const body: UpdateTaxZoneRequest = {};
    const controls = this.form.controls;
    if (controls.name.dirty) {
      // E5: backend expects Translatable JSONB. Single-locale form → wrap into
      // `{ default }`. A future feature ships a per-locale tabs editor.
      body.name = { default: raw.name.trim() };
    }
    if (controls.ratePercent.dirty) body.rate = Number(raw.ratePercent) / 100;
    if (controls.countries.dirty)
      body.countries = this.parseCountries(raw.countries) as [string, ...string[]];
    if (controls.priority.dirty) body.priority = Number(raw.priority);
    if (controls.isDefault.dirty) body.isDefault = raw.isDefault;
    if (controls.isCompound.dirty) body.isCompound = raw.isCompound;
    if (controls.isActive.dirty) body.isActive = raw.isActive;

    this.busy.set(true);
    this.error.set(null);
    this.tax.updateZone(this.current()!.id, body).subscribe({
      next: (z) => {
        this.current.set(z);
        this.seedForm(z);
        this.busy.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save tax zone.'));
      },
    });
  }

  private parseCountries(raw: string): string[] {
    return raw
      .split(/[,\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.tax
      .getZone(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (z) => {
          this.current.set(z);
          this.seedForm(z);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(z: TaxZone): void {
    // E5: response shape widened to `string | Translatable` (interceptor
    // typically resolves to string; admin reads with `X-Resolve-Locale: false`
    // would return the full object). Display the resolved-locale-equivalent
    // string in the single-field form.
    const displayName = pickTranslation(
      z.name as Translatable | string | null | undefined,
      this.authStore.locale(),
      '',
      this.storeSettings.defaultLocale(),
    );
    this.form.reset(
      {
        name: displayName,
        ratePercent: Number((z.rate * 100).toFixed(4)),
        countries: (z.countries ?? []).join(', '),
        priority: z.priority ?? 0,
        isDefault: z.isDefault ?? false,
        isCompound: z.isCompound ?? false,
        isActive: z.isActive ?? true,
      },
      { emitEvent: false },
    );
  }

  private formatError(err: unknown, fallback = 'Could not load tax zone.'): string {
    if (err instanceof ApiNotFoundError) return 'Tax zone not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to modify tax zones.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
