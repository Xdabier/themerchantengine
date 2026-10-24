import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  TranslatableInputComponent,
  type TranslatableValue,
} from '@admin-ui';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { CarriersService, type CarrierProvider, type CreateCarrierRequest } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';
import { isIsoCountry } from './shipping.utils';

const CODE_REGEX = /^[a-z0-9_]+$/;

function codeFormat(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return CODE_REGEX.test(value) ? null : { codeFormat: true };
}

@Component({
  selector: 'app-carrier-new-page',
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
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="carrier-new-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/shipping/carriers" class="hover:underline">Carriers</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">New</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Shipping</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Create carrier</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Registers a new carrier entry. Provider-specific credentials and services are edited on
          the detail page after creation.
        </p>
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="car-error"
        [class.border]="!!topError()"
        [class.border-status-error]="!!topError()"
        [class.text-ink]="!!topError()"
        [class.p-3]="!!topError()"
      >
        {{ topError() ?? '' }}
      </p>

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="flex flex-col gap-6 border border-line bg-surface p-6 md:p-8 max-w-3xl"
        novalidate
      >
        <app-form-field
          label="Code"
          [fieldId]="codeId"
          [error]="codeError()"
          hint="Lowercase letters, digits, underscores only. Example: dhl_express."
          [required]="true"
        >
          <app-input
            [id]="codeId"
            formControlName="code"
            autocomplete="off"
            [invalid]="!!codeError()"
            data-testid="car-code"
          />
        </app-form-field>

        <app-form-field label="Name" [fieldId]="nameId" [error]="nameError()" [required]="true">
          <app-translatable-input
            [inputId]="nameId"
            testId="car-name"
            idPrefix="car-name"
            label="Carrier name"
            formControlName="name"
            [invalid]="!!nameError()"
          />
        </app-form-field>

        <app-form-field
          label="Provider"
          [fieldId]="providerId"
          hint="Drives which upstream integration applies."
          [required]="true"
        >
          <select
            [id]="providerId"
            [attr.aria-describedby]="providerId + '-hint'"
            formControlName="provider"
            required
            class="min-h-[44px] w-full md:w-96 px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            data-testid="car-provider"
          >
            <option value="" disabled>— Select provider —</option>
            @for (p of providerOptions; track p) {
              <option [value]="p">{{ providerLabel(p) }}</option>
            }
          </select>
        </app-form-field>

        <app-form-field
          label="Services"
          [fieldId]="servicesInputId"
          hint="Operator-owned labels, comma-separated. Example: express, economy."
        >
          <app-input
            [id]="servicesInputId"
            autocomplete="off"
            [(ngModel)]="servicesDraft"
            [ngModelOptions]="{ standalone: true }"
            placeholder="express, economy"
            data-testid="car-services"
          />
        </app-form-field>

        <app-form-field
          label="Zones (ISO country codes)"
          [fieldId]="zonesInputId"
          hint="Comma-separated ISO alpha-2 codes. Empty = any destination."
        >
          <app-input
            [id]="zonesInputId"
            autocomplete="off"
            [(ngModel)]="zonesDraft"
            [ngModelOptions]="{ standalone: true }"
            placeholder="QA, SA, AE"
            data-testid="car-zones"
            [describedBy]="invalidZone() ? 'car-zones-invalid' : null"
          />
          <p
            id="car-zones-invalid"
            class="text-xs text-status-error mt-2"
            role="alert"
            data-testid="car-zones-invalid"
            [class.sr-only]="!invalidZone()"
          >
            @if (invalidZone()) {
              "{{ invalidZone() }}" is not a valid ISO alpha-2 country code.
            }
          </p>
        </app-form-field>

        <div class="grid gap-4 md:grid-cols-2 items-start">
          <app-form-field label="Sort order" [fieldId]="sortId" hint="Integer ≥ 0.">
            <app-input
              [id]="sortId"
              type="number"
              formControlName="sortOrder"
              data-testid="car-sort"
            />
          </app-form-field>
          <label class="inline-flex items-center gap-3 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              formControlName="isActive"
              class="h-5 w-5 border border-line bg-surface"
              data-testid="car-isactive"
            />
            <span class="text-sm text-ink">Carrier is active</span>
          </label>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2">
          <a
            routerLink="/shipping/carriers"
            class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-5 py-3 text-sm min-h-[44px]"
            data-testid="car-cancel"
          >
            Cancel
          </a>
          <app-button
            type="submit"
            [disabled]="form.invalid || saving()"
            [loading]="saving()"
            data-testid="car-save"
          >
            Create carrier
          </app-button>
        </div>
      </form>
    </section>
  `,
})
export class CarrierNewPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly carriers = inject(CarriersService);
  private readonly destroy$ = new Subject<void>();

  readonly codeId = 'car-code';
  readonly nameId = 'car-name-default';
  readonly providerId = 'car-provider';
  readonly servicesInputId = 'car-services';
  readonly zonesInputId = 'car-zones';
  readonly sortId = 'car-sort';

  readonly saving = signal(false);
  readonly topError = signal<string | null>(null);
  readonly invalidZone = signal<string | null>(null);
  readonly conflict = signal(false);

  servicesDraft = '';
  zonesDraft = '';

  readonly providerOptions: readonly CarrierProvider[] = [
    'dhl',
    'fedex',
    'ups',
    'aramex',
    'manual',
  ];

  readonly form = this.fb.nonNullable.group({
    code: [
      '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(50), codeFormat],
    ],
    name: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [translatableRequired]),
    provider: this.fb.nonNullable.control<CarrierProvider | ''>('' as CarrierProvider | '', [
      Validators.required,
    ]),
    isActive: this.fb.nonNullable.control<boolean>(true),
    sortOrder: this.fb.nonNullable.control<number>(0, [Validators.min(0)]),
  });

  providerLabel(p: CarrierProvider): string {
    switch (p) {
      case 'dhl':
        return 'DHL';
      case 'fedex':
        return 'FedEx';
      case 'ups':
        return 'UPS';
      case 'aramex':
        return 'Aramex';
      case 'manual':
        return 'Manual';
      default:
        return p;
    }
  }

  codeError(): string | null {
    const c = this.form.controls.code;
    if (this.conflict()) return 'A carrier with this code already exists.';
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('required')) return 'Code is required.';
    if (c.hasError('minlength')) return 'Code must be at least 2 characters.';
    if (c.hasError('maxlength')) return 'Code must be 50 characters or fewer.';
    if (c.hasError('codeFormat')) {
      return 'Use lowercase letters, digits, and underscores only.';
    }
    return null;
  }

  nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('translatableRequired')) return 'Default-locale name is required.';
    return null;
  }

  ngOnInit(): void {
    this.form.controls.code.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.conflict()) this.conflict.set(false);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      queueMicrotask(() => this.focusFirstInvalid());
      return;
    }

    const services = this.parseCsv(this.servicesDraft);
    const zones = this.parseCsv(this.zonesDraft).map((z) => z.toUpperCase());
    for (const z of zones) {
      if (!/^[A-Z]{2}$/.test(z) || !isIsoCountry(z)) {
        this.invalidZone.set(z);
        return;
      }
    }
    this.invalidZone.set(null);

    this.saving.set(true);
    this.topError.set(null);
    const raw = this.form.getRawValue();
    const payload: CreateCarrierRequest = {
      code: raw.code,
      name: raw.name,
      provider: raw.provider as CarrierProvider,
      isActive: raw.isActive,
      sortOrder: raw.sortOrder,
      ...(services.length > 0 ? { services } : {}),
      ...(zones.length > 0 ? { zones } : {}),
    };

    this.carriers
      .create(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (c) => {
          this.saving.set(false);
          void this.router.navigate(['/shipping/carriers', c.id]);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          if (this.isConflict(err)) {
            this.conflict.set(true);
            this.form.controls.code.setErrors({ conflict: true });
            this.form.controls.code.markAsTouched();
            queueMicrotask(() => document.getElementById(this.codeId)?.focus());
            return;
          }
          this.topError.set(this.formatError(err));
        },
      });
  }

  private focusFirstInvalid(): void {
    const order: Array<[string, AbstractControl]> = [
      [this.codeId, this.form.controls.code],
      [this.nameId, this.form.controls.name],
      [this.providerId, this.form.controls.provider],
      [this.sortId, this.form.controls.sortOrder],
    ];
    for (const [id, control] of order) {
      if (control.invalid) {
        document.getElementById(id)?.focus();
        return;
      }
    }
  }

  private isConflict(err: unknown): boolean {
    return err instanceof ApiConflictError;
  }

  private parseCsv(raw: string): string[] {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to create carriers.';
    if (err instanceof ApiNotFoundError) return 'Carrier not found.';
    if (err instanceof ApiConflictError) return 'Code conflict — pick a different code.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not create the carrier. Please retry.';
  }
}
