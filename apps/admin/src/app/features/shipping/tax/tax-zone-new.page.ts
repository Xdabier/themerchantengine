import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import { TaxService, type CreateTaxZoneRequest } from '@admin-services';
import { ApiError, ApiConflictError, ApiForbiddenError } from '@admin-types';
import { AuthStore } from '../../../core/stores/auth.store';

/**
 * `/shipping/tax/zones/new` — create a tax zone.
 *
 * Rate entered as a percent (0–100) and converted to the 0..1 fraction
 * the backend stores. Countries entered as a comma-separated ISO2 list
 * to match the editor surface — a full country picker is overkill when
 * most zones list 1–5 codes.
 */
@Component({
  selector: 'app-tax-zone-new-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="tax-zone-new-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/shipping/tax"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Tax zones
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">New zone</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">New tax zone</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Pick the countries, set the rate, and save. The zone will apply to checkout for every
          matching country immediately.
        </p>
      </header>

      <div role="alert" aria-atomic="true" data-testid="tax-zone-new-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (!canManage()) {
        <p
          class="border border-line p-4 text-sm text-ink-muted"
          data-testid="tax-zone-new-forbidden"
        >
          You do not have permission to create tax zones.
        </p>
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          <app-form-field label="Name" fieldId="tax-name" [required]="true" [error]="nameError()">
            <app-input
              id="tax-name"
              type="text"
              formControlName="name"
              [invalid]="!!nameError()"
            ></app-input>
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
              {{ form.dirty ? 'Unsaved changes' : 'Start filling the form' }}
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
                [disabled]="form.invalid || busy() || !form.dirty"
                [loading]="busy()"
                data-testid="tax-save"
              >
                Create zone
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class TaxZoneNewPage {
  private readonly tax = inject(TaxService);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private readonly fb = inject(FormBuilder);

  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(100)]),
    ratePercent: this.fb.nonNullable.control(0, [
      Validators.required,
      Validators.min(0),
      Validators.max(100),
    ]),
    countries: this.fb.nonNullable.control('', [Validators.required]),
    priority: this.fb.nonNullable.control(0, [Validators.min(0)]),
    isDefault: this.fb.nonNullable.control(false),
    isCompound: this.fb.nonNullable.control(false),
    isActive: this.fb.nonNullable.control(true),
  });

  nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Name is required.';
    if (c.hasError('maxlength')) return 'Name must be 100 characters or fewer.';
    return null;
  }

  rateError(): string | null {
    const c = this.form.controls.ratePercent;
    if (!c.touched) return null;
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
    if (this.countriesError()) return;

    const raw = this.form.getRawValue();
    const countries = this.parseCountries(raw.countries);
    if (countries.length === 0) return;
    const body: CreateTaxZoneRequest = {
      // E5: backend expects Translatable JSONB. Single-locale form → wrap into
      // `{ default }`. A future feature ships a per-locale tabs editor.
      name: { default: raw.name.trim() },
      rate: Number(raw.ratePercent) / 100,
      countries: countries as [string, ...string[]],
      priority: Number(raw.priority),
      isDefault: raw.isDefault,
      isCompound: raw.isCompound,
      isActive: raw.isActive,
    };

    this.busy.set(true);
    this.error.set(null);
    this.tax.createZone(body).subscribe({
      next: (z) => {
        this.busy.set(false);
        void this.router.navigate(['/shipping/tax', z.id]);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  private parseCountries(raw: string): string[] {
    return raw
      .split(/[,\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to create tax zones.';
    if (err instanceof ApiConflictError)
      return err.message || 'A tax zone with these details already exists.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not create tax zone.';
  }
}
