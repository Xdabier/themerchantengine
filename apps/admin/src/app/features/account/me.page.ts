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
import { RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  openConfirmDialog,
} from '@admin-ui';
import { UsersService } from '@admin-services';
import {
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  ApiValidationError,
  type AdminUser,
} from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';
import { localeLabel } from '../../shared/format/locale';
import { fullName, initials, statusLabel, statusTone } from '../users/users.utils';

/**
 * `/me` — authenticated user's own profile.
 *
 * Name, phone, and locale are free-text edits. Email is editable but
 * requires a confirm dialog because changing it on the storefront
 * changes the login identity — a separate email-verification flow is
 * out of scope for this slice.
 */
@Component({
  selector: 'app-me-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl" data-testid="me-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Account</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">My profile</h1>
      </header>

      <div role="alert" data-testid="me-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" data-testid="me-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">Profile updated.</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="3rem" width="40%" />
          <app-skeleton height="12rem" width="100%" />
        </div>
      } @else if (current(); as u) {
        <div class="flex items-center gap-5" role="group" aria-label="Profile summary">
          <div
            class="flex items-center justify-center w-16 h-16 border border-line text-ink text-xl font-bold"
            aria-hidden="true"
            data-testid="me-avatar"
          >
            {{ avatar(u) }}
          </div>
          <div class="min-w-0">
            <h2 class="text-2xl font-bold tracking-tight truncate">{{ name(u) }}</h2>
            <p class="mt-1 text-sm text-ink-muted truncate">{{ u.email }}</p>
            <div class="flex items-center gap-2 mt-2 flex-wrap">
              <app-badge
                [tone]="statusTone(u.status)"
                [ariaLabel]="'Account status: ' + statusLabel(u.status)"
              >
                {{ statusLabel(u.status) }}
              </app-badge>
              @for (r of u.roles; track r.id) {
                <app-badge tone="neutral" [ariaLabel]="'Role: ' + r.name">
                  {{ r.name }}
                </app-badge>
              }
            </div>
          </div>
        </div>

        <a
          routerLink="/me/security"
          class="text-ink text-xs tracking-widest uppercase border-b border-ink pb-1 w-fit"
          data-testid="me-security-link"
        >
          Two-factor authentication
        </a>

        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5"
          novalidate
          [attr.aria-busy]="busy() ? 'true' : null"
        >
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field label="First name" fieldId="me-first">
              <app-input id="me-first" type="text" formControlName="firstName"></app-input>
            </app-form-field>
            <app-form-field label="Last name" fieldId="me-last">
              <app-input id="me-last" type="text" formControlName="lastName"></app-input>
            </app-form-field>
          </div>

          <app-form-field
            label="Email"
            fieldId="me-email"
            [required]="true"
            [error]="emailError()"
            hint="Changing your email updates your login identity — you'll be asked to confirm."
          >
            <app-input
              id="me-email"
              type="email"
              formControlName="email"
              [invalid]="!!emailError()"
              autocomplete="email"
            ></app-input>
          </app-form-field>

          <app-form-field label="Phone" fieldId="me-phone">
            <app-input
              id="me-phone"
              type="tel"
              formControlName="phone"
              autocomplete="tel"
            ></app-input>
          </app-form-field>

          <app-form-field
            label="Language"
            fieldId="me-locale"
            hint="Affects the admin UI locale. Storefront respects customer preference separately."
          >
            <select
              id="me-locale"
              aria-describedby="me-locale-hint"
              class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              formControlName="locale"
              data-testid="me-locale-select"
            >
              @for (code of localeOptions(); track code) {
                <option [value]="code">{{ localeLabel(code) }}</option>
              }
            </select>
          </app-form-field>

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
                data-testid="me-revert"
              >
                Revert
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || !form.dirty"
                [loading]="busy()"
                data-testid="me-save"
              >
                Save profile
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class MePage implements OnInit, OnDestroy {
  private readonly users = inject(UsersService);
  private readonly authStore = inject(AuthStore);
  private readonly dialog = inject(Dialog);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<AdminUser | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);

  readonly canEdit = computed(() => this.authStore.isAuthenticated());

  /**
   * The locales an operator can pick, from the store's own settings. Hardcoding
   * the list here is what made French unselectable on the one screen where an
   * operator chooses their working language.
   */
  protected readonly localeOptions = this.storeSettings.supportedLocales;
  protected readonly localeLabel = localeLabel;

  protected readonly name = fullName;
  protected readonly avatar = initials;
  protected readonly statusTone = statusTone;
  protected readonly statusLabel = statusLabel;

  readonly form = this.fb.nonNullable.group({
    firstName: this.fb.nonNullable.control(''),
    lastName: this.fb.nonNullable.control(''),
    email: this.fb.nonNullable.control('', [Validators.required, Validators.email]),
    phone: this.fb.nonNullable.control(''),
    locale: this.fb.nonNullable.control(this.storeSettings.defaultLocale()),
  });

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  emailError(): string | null {
    const c = this.form.controls.email;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Email is required.';
    if (c.hasError('email')) return 'Enter a valid email address.';
    return null;
  }

  revert(): void {
    const c = this.current();
    if (c) this.seedForm(c);
  }

  async save(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.form.dirty) return;
    const raw = this.form.getRawValue();
    const current = this.current();
    if (!current) return;

    if (this.form.controls.email.dirty && raw.email !== current.email) {
      const ok = await openConfirmDialog(this.dialog, {
        title: 'Change your email?',
        body: `This updates your login identity to "${raw.email}". You'll need to use the new email to sign in after this.`,
        confirmLabel: 'Change email',
        tone: 'destructive',
      });
      if (!ok) return;
    }

    const body: Record<string, string | undefined> = {};
    if (this.form.controls.firstName.dirty) body['firstName'] = raw.firstName.trim();
    if (this.form.controls.lastName.dirty) body['lastName'] = raw.lastName.trim();
    if (this.form.controls.email.dirty) body['email'] = raw.email.trim();
    if (this.form.controls.phone.dirty) body['phone'] = raw.phone.trim();
    if (this.form.controls.locale.dirty) body['locale'] = raw.locale;

    const localeDirty = this.form.controls.locale.dirty;
    this.busy.set(true);
    this.error.set(null);
    this.users.updateMe(body as never).subscribe({
      next: (updated) => {
        this.current.set(updated);
        this.seedForm(updated);
        if (localeDirty && updated.locale) {
          this.authStore.setLocale(updated.locale);
        }
        this.busy.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save profile.'));
      },
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.users
      .me()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (u) => {
          this.current.set(u);
          this.seedForm(u);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(u: AdminUser): void {
    this.form.reset(
      {
        firstName: u.firstName ?? '',
        lastName: u.lastName ?? '',
        email: u.email,
        phone: '',
        locale: u.locale ?? this.storeSettings.defaultLocale(),
      },
      { emitEvent: false },
    );
  }

  private formatError(err: unknown, fallback = 'Could not load profile.'): string {
    if (err instanceof ApiConflictError) return 'Email already in use on another account.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to edit this profile.';
    if (err instanceof ApiNotFoundError) return 'Profile not found.';
    if (err instanceof ApiValidationError && err.message) return err.message;
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
