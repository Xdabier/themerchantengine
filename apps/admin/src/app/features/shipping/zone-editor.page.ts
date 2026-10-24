import {
  ChangeDetectionStrategy,
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
  FormsModule,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
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
  type CreateShippingZoneRequest,
  type UpdateShippingZoneRequest,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';
import { isIsoCountry } from './shipping.utils';

function countriesNonEmpty(control: AbstractControl): ValidationErrors | null {
  const value = control.value as string[] | null;
  if (!Array.isArray(value) || value.length === 0) return { countriesRequired: true };
  return null;
}

function postalRangeValid(group: AbstractControl): ValidationErrors | null {
  const from = (group.get('from')?.value ?? '') as string;
  const to = (group.get('to')?.value ?? '') as string;
  if (!from && !to) return null;
  if (!from || !to) return { postalRangeIncomplete: true };
  return from <= to ? null : { postalRangeInverted: true };
}

@Component({
  selector: 'app-shipping-zone-editor-page',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="shipping-zone-editor-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/shipping/zones" class="hover:underline">Shipping zones</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">{{ isEditMode() ? 'Edit' : 'New' }}</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
          {{ isEditMode() ? 'Edit shipping zone' : 'Create shipping zone' }}
        </h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Countries are listed by their ISO 3166-1 alpha-2 codes. Lower priority wins when zones
          overlap.
        </p>
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="zone-error"
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
            label="Name"
            [fieldId]="nameId"
            [error]="nameError()"
            hint="Default locale is required; other locales fall back to default."
            [required]="true"
          >
            <app-translatable-input
              [inputId]="nameId"
              testId="zone-name"
              idPrefix="zone-name"
              label="Zone name"
              formControlName="name"
              [invalid]="!!nameError()"
            />
          </app-form-field>

          <app-form-field
            label="Countries"
            [fieldId]="countryInputId"
            [error]="countriesError()"
            hint="Enter ISO 3166-1 alpha-2 codes (e.g. QA, SA). Press Enter to add."
            [required]="true"
          >
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-2">
                <app-input
                  [id]="countryInputId"
                  [invalid]="!!countriesError() || !!invalidIso()"
                  placeholder="QA"
                  autocomplete="off"
                  maxLength="2"
                  data-testid="zone-country-input"
                  [describedBy]="invalidIso() ? 'zone-country-iso-error' : null"
                  [(ngModel)]="countryDraft"
                  [ngModelOptions]="{ standalone: true }"
                  (keydown.enter)="onCountryEnter($event)"
                />
                <app-button variant="secondary" size="sm" type="button" (clicked)="addCountry()">
                  Add
                </app-button>
              </div>
              <p
                id="zone-country-iso-error"
                class="text-xs text-status-error"
                role="alert"
                data-testid="zone-country-invalid"
                [class.sr-only]="!invalidIso()"
              >
                @if (invalidIso()) {
                  "{{ invalidIso() }}" is not a valid ISO alpha-2 country code.
                }
              </p>
              <ul class="flex items-center gap-2 flex-wrap" aria-label="Selected countries">
                @for (c of selectedCountries(); track c) {
                  <li>
                    <button
                      type="button"
                      class="inline-flex items-center gap-2 border border-line bg-surface text-ink text-xs tracking-widest uppercase px-3 py-2 min-h-[44px] focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 hover:bg-surface-elevated"
                      [attr.data-testid]="'zone-country-chip-' + c"
                      [attr.aria-label]="'Remove ' + c"
                      (click)="removeCountry(c)"
                    >
                      {{ c }}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                }
              </ul>
            </div>
          </app-form-field>

          <div class="grid gap-4 md:grid-cols-2">
            <app-form-field
              label="Priority"
              [fieldId]="priorityId"
              [error]="priorityError()"
              hint="Integer ≥ 0. Lower number wins when zones overlap."
            >
              <app-input
                [id]="priorityId"
                type="number"
                formControlName="priority"
                [invalid]="!!priorityError()"
                data-testid="zone-priority"
              />
            </app-form-field>
          </div>

          <fieldset class="flex flex-col gap-3" formArrayName="postalCodeRanges">
            <legend class="text-sm font-medium text-ink">Postal code ranges</legend>
            <p class="text-xs text-ink-muted">Optional. Both from and to must be set; from ≤ to.</p>
            @for (group of postalCodeRanges.controls; track $index; let i = $index) {
              <div
                class="grid grid-cols-[1fr_1fr_auto] gap-3 items-end"
                [formGroupName]="i"
                [attr.data-testid]="'zone-postal-row-' + i"
              >
                <app-form-field label="From" [fieldId]="'zone-postal-from-' + i">
                  <app-input
                    [id]="'zone-postal-from-' + i"
                    formControlName="from"
                    [attr.data-testid]="'zone-postal-from-' + i"
                  />
                </app-form-field>
                <app-form-field label="To" [fieldId]="'zone-postal-to-' + i">
                  <app-input
                    [id]="'zone-postal-to-' + i"
                    formControlName="to"
                    [attr.data-testid]="'zone-postal-to-' + i"
                  />
                </app-form-field>
                <app-button
                  variant="ghost"
                  size="sm"
                  type="button"
                  (clicked)="removePostalRange(i)"
                  [ariaLabel]="'Remove range ' + (i + 1)"
                >
                  Remove
                </app-button>
              </div>
            }
            <app-button
              variant="secondary"
              size="sm"
              type="button"
              (clicked)="addPostalRange()"
              data-testid="zone-postal-add"
            >
              Add range
            </app-button>
          </fieldset>

          <label class="inline-flex items-center gap-3 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              formControlName="isActive"
              class="h-5 w-5 border border-line bg-surface"
              data-testid="zone-isactive"
            />
            <span class="text-sm text-ink">Zone is active</span>
          </label>

          <div class="flex items-center justify-end gap-3 pt-2">
            <a
              routerLink="/shipping/zones"
              class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-5 py-3 text-sm min-h-[44px]"
              data-testid="zone-cancel"
            >
              Cancel
            </a>
            <app-button
              type="submit"
              [disabled]="form.invalid || saving()"
              [loading]="saving()"
              data-testid="zone-save"
            >
              {{ isEditMode() ? 'Save changes' : 'Create zone' }}
            </app-button>
          </div>
        </form>
      }
    </section>
  `,
})
export class ShippingZoneEditorPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly shipping = inject(ShippingService);
  private readonly destroy$ = new Subject<void>();

  readonly nameId = 'zone-name-default';
  readonly countryInputId = 'zone-country-input';
  readonly priorityId = 'zone-priority';

  readonly editingId = signal<string | null>(null);
  readonly isEditMode = computed(() => this.editingId() !== null);
  readonly saving = signal(false);
  readonly loadingInitial = signal(false);
  readonly topError = signal<string | null>(null);
  readonly selectedCountries = signal<string[]>([]);
  readonly invalidIso = signal<string | null>(null);

  countryDraft = '';

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [translatableRequired]),
    countries: this.fb.nonNullable.control<string[]>([], [countriesNonEmpty]),
    priority: this.fb.nonNullable.control<number>(0, [Validators.min(0)]),
    isActive: this.fb.nonNullable.control<boolean>(true),
    postalCodeRanges: this.fb.array<ReturnType<typeof this.buildPostalRange>>([]),
  });

  get postalCodeRanges(): FormArray {
    return this.form.controls.postalCodeRanges;
  }

  nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('translatableRequired')) return 'Default-locale name is required.';
    return null;
  }

  countriesError(): string | null {
    const c = this.form.controls.countries;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('countriesRequired')) return 'At least one country is required.';
    return null;
  }

  priorityError(): string | null {
    const c = this.form.controls.priority;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('min')) return 'Priority must be 0 or greater.';
    return null;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.loadingInitial.set(true);
      this.shipping
        .listZones({ pageSize: 100 })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            const match = res.data.find((z) => z.id === id);
            if (!match) {
              this.loadingInitial.set(false);
              this.topError.set('Zone not found.');
              return;
            }
            this.form.patchValue({
              name: match.name,
              priority: match.priority,
              isActive: match.isActive,
            });
            this.selectedCountries.set([...match.countries]);
            this.form.controls.countries.setValue([...match.countries]);
            if (match.postalCodeRanges && match.postalCodeRanges.length > 0) {
              for (const r of match.postalCodeRanges) {
                this.postalCodeRanges.push(this.buildPostalRange(r.from, r.to));
              }
            }
            this.form.markAsPristine();
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

  onCountryEnter(event: Event): void {
    event.preventDefault();
    this.addCountry();
  }

  addCountry(): void {
    // Deliberately NOT normalising to upper-case: the spec requires users to
    // type the code in the correct ISO 3166-1 alpha-2 format (two uppercase
    // letters). Lowercase input is treated as an invalid code so the user
    // knows they need to correct it (specs/admin-dashboard/tasks.md R5.5.2).
    const raw = (this.countryDraft ?? '').trim();
    if (!raw) return;
    if (!/^[A-Z]{2}$/.test(raw) || !isIsoCountry(raw)) {
      this.invalidIso.set(raw);
      return;
    }
    this.invalidIso.set(null);
    const next = Array.from(new Set([...this.selectedCountries(), raw]));
    this.selectedCountries.set(next);
    this.form.controls.countries.setValue(next);
    this.form.controls.countries.markAsTouched();
    this.form.controls.countries.markAsDirty();
    this.countryDraft = '';
  }

  removeCountry(code: string): void {
    const next = this.selectedCountries().filter((c) => c !== code);
    this.selectedCountries.set(next);
    this.form.controls.countries.setValue(next);
    this.form.controls.countries.markAsDirty();
  }

  addPostalRange(): void {
    this.postalCodeRanges.push(this.buildPostalRange('', ''));
  }

  removePostalRange(index: number): void {
    this.postalCodeRanges.removeAt(index);
    this.form.markAsDirty();
  }

  submit(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      queueMicrotask(() => this.focusFirstInvalid());
      return;
    }
    this.saving.set(true);
    this.topError.set(null);

    const raw = this.form.getRawValue();
    const postalCodeRanges = raw.postalCodeRanges
      .filter((r) => r.from && r.to)
      .map((r) => ({ from: r.from, to: r.to }));

    const id = this.editingId();
    if (id) {
      const patch: UpdateShippingZoneRequest = {
        name: raw.name,
        countries: raw.countries as [string, ...string[]],
        priority: raw.priority,
        isActive: raw.isActive,
        ...(postalCodeRanges.length > 0 ? { postalCodeRanges } : {}),
      };
      this.shipping
        .updateZone(id, patch)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.saving.set(false);
            void this.router.navigate(['/shipping/zones']);
          },
          error: (err: unknown) => {
            this.saving.set(false);
            this.topError.set(this.formatError(err));
          },
        });
      return;
    }

    const payload: CreateShippingZoneRequest = {
      name: raw.name,
      countries: raw.countries as [string, ...string[]],
      priority: raw.priority,
      isActive: raw.isActive,
      ...(postalCodeRanges.length > 0 ? { postalCodeRanges } : {}),
    };
    this.shipping
      .createZone(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.saving.set(false);
          void this.router.navigate(['/shipping/zones']);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.topError.set(this.formatError(err));
        },
      });
  }

  private focusFirstInvalid(): void {
    const order: Array<[string, AbstractControl]> = [
      [this.nameId, this.form.controls.name],
      [this.countryInputId, this.form.controls.countries],
      [this.priorityId, this.form.controls.priority],
    ];
    for (const [id, control] of order) {
      if (control.invalid) {
        document.getElementById(id)?.focus();
        return;
      }
    }
  }

  private buildPostalRange(from: string, to: string) {
    return this.fb.nonNullable.group(
      {
        from: this.fb.nonNullable.control<string>(from),
        to: this.fb.nonNullable.control<string>(to),
      },
      { validators: postalRangeValid },
    );
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to manage shipping zones.';
    if (err instanceof ApiNotFoundError) return 'Zone not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save the zone. Please retry.';
  }
}
