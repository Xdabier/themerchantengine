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
  CheckoutSettingsService,
  type CheckoutRequiredField,
  type CheckoutSettings,
  type UpdateCheckoutSettingsRequest,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';

/**
 * `/checkout-settings` — site-wide checkout policy.
 *
 * The required-fields checkbox set is a fixed allow-list (matches the
 * backend Zod schema). URL fields accept empty string → null so
 * operators can clear a previously-set link without hunting for the
 * "remove" affordance.
 */
@Component({
  selector: 'app-checkout-settings-page',
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
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl" data-testid="checkout-settings-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Checkout settings</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          Controls how the storefront collects customer info + what links surface at checkout.
        </p>
      </header>

      <div role="status" aria-live="polite" data-testid="checkout-settings-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="checkout-settings-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">Settings saved.</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="30%" />
          <app-skeleton height="8rem" width="100%" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-5" novalidate>
          <label class="inline-flex items-center gap-3 text-sm tabular">
            <input
              type="checkbox"
              formControlName="guestCheckoutEnabled"
              class="h-4 w-4 accent-ink"
              data-testid="checkout-guest-toggle"
            />
            Allow guest checkout
          </label>

          <fieldset class="border border-line p-4" data-testid="checkout-required-fields">
            <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">
              Required at checkout
            </legend>
            <p class="text-xs tabular text-ink-muted mb-3">
              Pick which fields the storefront blocks checkout on if missing.
            </p>
            <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2" role="list">
              @for (opt of requiredFieldOptions; track opt.value) {
                <li>
                  <label class="flex items-center gap-3 text-sm tabular">
                    <input
                      type="checkbox"
                      class="h-4 w-4 accent-ink"
                      [checked]="isRequired(opt.value)"
                      (change)="toggleRequired(opt.value, $event)"
                      [attr.data-testid]="'checkout-required-' + opt.value"
                    />
                    {{ opt.label }}
                  </label>
                </li>
              }
            </ul>
          </fieldset>

          <app-form-field
            label="Terms of service URL"
            fieldId="checkout-tos"
            [error]="urlError('termsOfServiceUrl')"
            hint="Shown in the checkout footer. Leave empty to hide."
          >
            <app-input
              id="checkout-tos"
              type="url"
              formControlName="termsOfServiceUrl"
              [invalid]="!!urlError('termsOfServiceUrl')"
            ></app-input>
          </app-form-field>

          <app-form-field
            label="Post-purchase redirect URL"
            fieldId="checkout-redirect"
            [error]="urlError('postPurchaseRedirectUrl')"
            hint="Where the storefront sends customers after a successful checkout."
          >
            <app-input
              id="checkout-redirect"
              type="url"
              formControlName="postPurchaseRedirectUrl"
              [invalid]="!!urlError('postPurchaseRedirectUrl')"
            ></app-input>
          </app-form-field>

          <app-form-field
            label="Checkout notice"
            fieldId="checkout-message"
            hint="Optional short text shown above the payment methods block. 500 chars max."
          >
            <app-input
              id="checkout-message"
              type="text"
              formControlName="checkoutMessage"
            ></app-input>
          </app-form-field>

          <footer class="flex items-center justify-between">
            <p class="text-xs tabular text-ink-muted">
              {{ form.dirty || requiredDirty() ? 'Unsaved changes' : 'No changes' }}
            </p>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy()"
                routerLink="/"
                data-testid="checkout-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || (!form.dirty && !requiredDirty())"
                [loading]="busy()"
                data-testid="checkout-save"
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
export class CheckoutSettingsPage implements OnInit, OnDestroy {
  private readonly service = inject(CheckoutSettingsService);
  private readonly authStore = inject(AuthStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly current = signal<CheckoutSettings | null>(null);
  readonly requiredSelection = signal<ReadonlySet<CheckoutRequiredField>>(new Set());
  readonly requiredDirty = signal(false);
  private initialRequired: ReadonlySet<CheckoutRequiredField> = new Set();

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['checkout:manage']));

  readonly requiredFieldOptions: ReadonlyArray<{ value: CheckoutRequiredField; label: string }> = [
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'shippingAddress', label: 'Shipping address' },
    { value: 'billingAddress', label: 'Billing address' },
    { value: 'company', label: 'Company name' },
    { value: 'note', label: 'Order note' },
  ];

  readonly form = this.fb.nonNullable.group({
    guestCheckoutEnabled: this.fb.nonNullable.control(true),
    termsOfServiceUrl: this.fb.nonNullable.control(''),
    postPurchaseRedirectUrl: this.fb.nonNullable.control(''),
    checkoutMessage: this.fb.nonNullable.control('', [Validators.maxLength(500)]),
  });

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  isRequired(field: CheckoutRequiredField): boolean {
    return this.requiredSelection().has(field);
  }

  toggleRequired(field: CheckoutRequiredField, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.requiredSelection());
    if (checked) next.add(field);
    else next.delete(field);
    this.requiredSelection.set(next);
    this.requiredDirty.set(!this.setsEqual(next, this.initialRequired));
  }

  urlError(control: 'termsOfServiceUrl' | 'postPurchaseRedirectUrl'): string | null {
    const c = this.form.controls[control];
    const value = c.value.trim();
    if (value.length === 0) return null;
    try {
      // URL constructor rejects malformed strings — cheaper + stricter
      // than maintaining a duplicated regex, matches the backend IsUrl.
      // eslint-disable-next-line no-new
      new URL(value);
      return null;
    } catch {
      return 'Enter a full URL (https://…).';
    }
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.busy()) return;
    if (!this.form.dirty && !this.requiredDirty()) return;
    const tosErr = this.urlError('termsOfServiceUrl');
    const redirectErr = this.urlError('postPurchaseRedirectUrl');
    if (tosErr || redirectErr) {
      this.error.set(tosErr ?? redirectErr);
      return;
    }

    const raw = this.form.getRawValue();
    const body: UpdateCheckoutSettingsRequest = {};
    if (this.form.controls.guestCheckoutEnabled.dirty) {
      body.guestCheckoutEnabled = raw.guestCheckoutEnabled;
    }
    if (this.form.controls.termsOfServiceUrl.dirty) {
      body.termsOfServiceUrl = raw.termsOfServiceUrl.trim() || null;
    }
    if (this.form.controls.postPurchaseRedirectUrl.dirty) {
      body.postPurchaseRedirectUrl = raw.postPurchaseRedirectUrl.trim() || null;
    }
    if (this.form.controls.checkoutMessage.dirty) {
      body.checkoutMessage = raw.checkoutMessage.trim() || null;
    }
    if (this.requiredDirty()) {
      body.requiredFields = [...this.requiredSelection()];
    }

    this.busy.set(true);
    this.error.set(null);
    this.service.update(body).subscribe({
      next: (next) => {
        this.busy.set(false);
        this.applySettings(next);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save settings.'));
      },
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (s) => {
          this.applySettings(s);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private applySettings(s: CheckoutSettings): void {
    this.current.set(s);
    this.form.reset(
      {
        guestCheckoutEnabled: s.guestCheckoutEnabled,
        termsOfServiceUrl: s.termsOfServiceUrl ?? '',
        postPurchaseRedirectUrl: s.postPurchaseRedirectUrl ?? '',
        checkoutMessage: s.checkoutMessage ?? '',
      },
      { emitEvent: false },
    );
    const req = new Set(s.requiredFields as CheckoutRequiredField[]);
    this.requiredSelection.set(req);
    this.initialRequired = req;
    this.requiredDirty.set(false);
  }

  private setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  private formatError(err: unknown, fallback = 'Could not load checkout settings.'): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to manage checkout settings.';
    if (err instanceof ApiNotFoundError) return 'Checkout settings not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
