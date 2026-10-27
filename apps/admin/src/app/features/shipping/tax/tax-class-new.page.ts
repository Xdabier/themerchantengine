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
import { ButtonComponent, FormFieldComponent, InputComponent, SkeletonComponent } from '@admin-ui';
import { TaxService, type CreateTaxClassRequest, type TaxZone } from '@admin-services';
import { ApiError, ApiConflictError, ApiForbiddenError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../../core/stores/auth.store';
import { TranslatablePipe } from '../../../shared/pipes/translatable.pipe';

/**
 * `/shipping/tax/classes/new` — create a tax class inside an existing
 * zone. Zone select populated via `listZones()` — if the store has no
 * zones yet, the form blocks submit and nudges the operator to the
 * zone-create page first.
 */
@Component({
  selector: 'app-tax-class-new-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatablePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="tax-class-new-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/shipping/tax/classes"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Tax classes
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">New class</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">New tax class</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Name the tier (convention: Standard, Reduced, Zero-Rated, Exempt), pick the parent zone,
          and set the rate. Zero-Rated and Exempt names force 0% on the backend regardless of the
          rate you enter.
        </p>
      </header>

      <div role="alert" aria-atomic="true" data-testid="tax-class-new-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (!canManage()) {
        <p
          class="border border-line p-4 text-sm text-ink-muted"
          data-testid="tax-class-new-forbidden"
        >
          You do not have permission to create tax classes.
        </p>
      } @else if (zonesLoading()) {
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading tax zones"
          class="flex flex-col gap-4 max-w-xl"
        >
          <span class="sr-only">Loading tax zones…</span>
          <app-skeleton height="3rem" width="100%" />
          <app-skeleton height="3rem" width="100%" />
        </div>
      } @else if (zones().length === 0) {
        <p
          class="border border-line p-4 text-sm text-ink-muted max-w-xl"
          data-testid="tax-class-new-no-zones"
        >
          There are no tax zones yet. Create one first, then come back to add a class inside it.
          <a
            routerLink="/shipping/tax/zones/new"
            class="underline text-ink hover:no-underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            Create a zone
          </a>
          .
        </p>
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          <app-form-field
            label="Zone"
            fieldId="tax-class-zone"
            [required]="true"
            [error]="zoneError()"
          >
            <select
              id="tax-class-zone"
              formControlName="zoneId"
              class="w-full bg-surface border border-line text-ink text-sm p-2 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="tax-class-zone-select"
              [attr.aria-invalid]="zoneError() ? 'true' : null"
            >
              <option value="" disabled>Select a zone</option>
              @for (z of zones(); track z.id) {
                <option [value]="z.id">{{ z.name | translatable }}</option>
              }
            </select>
          </app-form-field>

          <app-form-field
            label="Name"
            fieldId="tax-class-name"
            [required]="true"
            [error]="nameError()"
            hint="Convention: Standard, Reduced, Zero-Rated, Exempt."
          >
            <app-input
              id="tax-class-name"
              type="text"
              formControlName="name"
              [invalid]="!!nameError()"
            ></app-input>
          </app-form-field>

          <app-form-field
            label="Rate (%)"
            fieldId="tax-class-rate"
            [required]="true"
            [error]="rateError()"
            hint="Percent between 0 and 100. Stored as the decimal fraction on the backend."
          >
            <app-input
              id="tax-class-rate"
              type="number"
              formControlName="ratePercent"
              [invalid]="!!rateError()"
              inputmode="decimal"
            ></app-input>
          </app-form-field>

          <label class="inline-flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              formControlName="isDefault"
              class="h-4 w-4 accent-ink"
              data-testid="tax-class-default"
            />
            Default class in this zone
          </label>

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
                routerLink="/shipping/tax/classes"
                data-testid="tax-class-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || !form.dirty"
                [loading]="busy()"
                data-testid="tax-class-save"
              >
                Create class
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class TaxClassNewPage implements OnInit, OnDestroy {
  private readonly tax = inject(TaxService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly zonesLoading = signal(true);
  readonly zones = signal<readonly TaxZone[]>([]);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  readonly form = this.fb.nonNullable.group({
    zoneId: this.fb.nonNullable.control('', [Validators.required]),
    name: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(100)]),
    ratePercent: this.fb.nonNullable.control(0, [
      Validators.required,
      Validators.min(0),
      Validators.max(100),
    ]),
    isDefault: this.fb.nonNullable.control(false),
  });

  ngOnInit(): void {
    this.loadZones();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

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

  zoneError(): string | null {
    const c = this.form.controls.zoneId;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Pick a zone.';
    return null;
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.form.dirty) return;

    const raw = this.form.getRawValue();
    const body: CreateTaxClassRequest = {
      zoneId: raw.zoneId,
      name: raw.name.trim(),
      rate: Number(raw.ratePercent) / 100,
      isDefault: raw.isDefault,
    };

    this.busy.set(true);
    this.error.set(null);
    this.tax.createClass(body).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate(['/shipping/tax/classes'], {
          queryParams: { zoneId: body.zoneId },
        });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  private loadZones(): void {
    const preselect = this.route.snapshot.queryParamMap.get('zoneId');
    this.zonesLoading.set(true);
    this.tax
      .listZones({ page: 1, pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.zones.set(res.data);
          this.zonesLoading.set(false);
          if (preselect && res.data.some((z) => z.id === preselect)) {
            this.form.controls.zoneId.setValue(preselect);
          }
        },
        error: (err: unknown) => {
          this.zonesLoading.set(false);
          this.error.set(this.formatError(err, 'Could not load tax zones.'));
        },
      });
  }

  private formatError(err: unknown, fallback = 'Could not create tax class.'): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to create tax classes.';
    if (err instanceof ApiConflictError)
      return err.message || 'A class with these details already exists in this zone.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
