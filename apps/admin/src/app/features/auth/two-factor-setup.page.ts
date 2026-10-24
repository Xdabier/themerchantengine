import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import { AuthService } from '@admin-services';
import { isStaff } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';

type View = 'start' | 'enrolling' | 'done' | 'enabled';

/**
 * TOTP 2FA enrolment + management (Scenario C) — the account security screen,
 * reached from `/me`. Authenticated route.
 *
 * Enrol: confirm the current password → Better Auth returns an `otpauth://`
 * URI + backup codes → the operator adds it to an authenticator app and
 * confirms with the first generated code. Disable: confirm the password.
 *
 * After a successful enable/disable the session is re-resolved with one
 * `getSession()` so `AuthStore` reflects the new `twoFactorEnabled` state
 * atomically (§3.15-C).
 */
@Component({
  selector: 'app-two-factor-setup-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      #sectionEl
      tabindex="-1"
      aria-labelledby="tf-heading"
      class="p-6 md:p-10 flex flex-col gap-8 max-w-2xl outline-none"
      data-testid="two-factor-setup"
    >
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Account security</p>
        <h1 id="tf-heading" class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">
          Two-factor authentication
        </h1>
      </header>

      @if (error()) {
        <p
          class="border border-status-error text-ink p-3 tabular text-xs"
          data-testid="two-factor-setup-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      @switch (view()) {
        @case ('enabled') {
          <div class="flex flex-col gap-5" data-testid="two-factor-enabled">
            <p class="border border-status-success text-ink p-3 tabular text-xs" role="status">
              Two-factor authentication is on. Sign-in asks for a code from your authenticator app.
            </p>
            <form
              [formGroup]="disableForm"
              (ngSubmit)="disable()"
              class="flex flex-col gap-5"
              novalidate
            >
              <app-form-field
                label="Confirm your password to turn it off"
                fieldId="tf-disable-password"
                [error]="disablePasswordError()"
                [required]="true"
              >
                <app-input
                  id="tf-disable-password"
                  type="password"
                  formControlName="password"
                  [invalid]="!!disablePasswordError()"
                  [autocomplete]="'current-password'"
                ></app-input>
              </app-form-field>
              <app-button
                type="submit"
                variant="ghost"
                size="md"
                [disabled]="disableForm.invalid"
                [loading]="busy()"
                data-testid="two-factor-disable-submit"
              >
                Disable two-factor
              </app-button>
            </form>
          </div>
        }
        @case ('start') {
          <form
            [formGroup]="enableForm"
            (ngSubmit)="enable()"
            class="flex flex-col gap-5"
            novalidate
          >
            <p class="text-sm text-ink-muted">
              Protect your account with a time-based code from an authenticator app.
            </p>
            <app-form-field
              label="Confirm your password"
              fieldId="tf-enable-password"
              [error]="enablePasswordError()"
              [required]="true"
            >
              <app-input
                id="tf-enable-password"
                type="password"
                formControlName="password"
                [invalid]="!!enablePasswordError()"
                [autocomplete]="'current-password'"
              ></app-input>
            </app-form-field>
            <app-button
              type="submit"
              variant="primary"
              size="md"
              [disabled]="enableForm.invalid"
              [loading]="busy()"
              data-testid="two-factor-enable-submit"
            >
              Enable two-factor
            </app-button>
          </form>
        }
        @case ('enrolling') {
          <div class="flex flex-col gap-6" data-testid="two-factor-enrolling">
            <div class="flex flex-col gap-2">
              <p class="text-sm text-ink-muted">
                Add this key to your authenticator app, then enter the 6-digit code it shows.
              </p>
              <div role="group" aria-labelledby="tf-secret-label" class="flex flex-col gap-2">
                <p id="tf-secret-label" class="text-xs uppercase tracking-widest text-ink-muted">
                  Setup key
                </p>
                <code
                  class="block break-all border border-line p-3 text-sm text-ink font-mono tabular"
                  data-testid="two-factor-secret"
                  >{{ secret() }}</code
                >
              </div>
              <div role="group" aria-labelledby="tf-uri-label" class="flex flex-col gap-2 mt-2">
                <p id="tf-uri-label" class="text-xs uppercase tracking-widest text-ink-muted">
                  Setup URI
                </p>
                <code
                  class="block break-all border border-line p-3 text-xs text-ink-muted font-mono"
                  data-testid="two-factor-uri"
                  >{{ totpUri() }}</code
                >
              </div>
            </div>

            @if (backupCodes().length) {
              <div class="flex flex-col gap-2">
                <p id="tf-backup-label" class="text-xs uppercase tracking-widest text-ink-muted">
                  Backup codes — store them somewhere safe
                </p>
                <ul
                  class="grid grid-cols-2 gap-2 border border-line p-3"
                  aria-labelledby="tf-backup-label"
                  data-testid="two-factor-backup-codes"
                >
                  @for (code of backupCodes(); track code) {
                    <li class="text-sm text-ink font-mono tabular">{{ code }}</li>
                  }
                </ul>
              </div>
            }

            <form
              [formGroup]="confirmForm"
              (ngSubmit)="confirm()"
              class="flex flex-col gap-5"
              novalidate
            >
              <app-form-field
                label="Authentication code"
                fieldId="tf-confirm-code"
                [error]="codeError()"
                [required]="true"
              >
                <app-input
                  id="tf-confirm-code"
                  type="text"
                  inputmode="numeric"
                  formControlName="code"
                  placeholder="123456"
                  [invalid]="!!codeError()"
                  [autocomplete]="'one-time-code'"
                ></app-input>
              </app-form-field>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="confirmForm.invalid"
                [loading]="busy()"
                data-testid="two-factor-confirm-submit"
              >
                Confirm and enable
              </app-button>
            </form>
          </div>
        }
        @case ('done') {
          <p
            class="border border-status-success text-ink p-3 tabular text-xs"
            data-testid="two-factor-done"
            role="status"
          >
            Two-factor authentication is now enabled on your account.
          </p>
        }
      }

      <a
        routerLink="/me"
        class="text-ink text-xs tracking-widest uppercase border-b border-ink pb-1 w-fit"
      >
        Back to profile
      </a>
    </section>
  `,
})
export class TwoFactorSetupPage {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly sectionEl = viewChild<ElementRef<HTMLElement>>('sectionEl');

  readonly view = signal<View>(this.authStore.user()?.twoFactorEnabled ? 'enabled' : 'start');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly totpUri = signal('');
  readonly secret = signal('');
  readonly backupCodes = signal<string[]>([]);

  readonly enableForm = this.fb.nonNullable.group({
    password: ['', [Validators.required]],
  });
  readonly confirmForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  readonly disableForm = this.fb.nonNullable.group({
    password: ['', [Validators.required]],
  });

  codeError(): string | null {
    const c = this.confirmForm.controls.code;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Enter the code from your authenticator app.';
    if (c.hasError('pattern')) return 'The code is 6 digits.';
    return null;
  }

  enablePasswordError(): string | null {
    const c = this.enableForm.controls.password;
    return c.touched && c.hasError('required') ? 'Enter your current password.' : null;
  }

  disablePasswordError(): string | null {
    const c = this.disableForm.controls.password;
    return c.touched && c.hasError('required') ? 'Enter your current password.' : null;
  }

  async enable(): Promise<void> {
    this.enableForm.markAllAsTouched();
    if (this.enableForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const result = await this.authService.enableTwoFactor(this.enableForm.getRawValue().password);
    this.busy.set(false);
    if (!result.ok) {
      this.error.set(this.failureMessage(result.failure.status));
      return;
    }
    this.totpUri.set(result.totpUri);
    this.secret.set(extractSecret(result.totpUri));
    this.backupCodes.set(result.backupCodes);
    this.enableForm.reset();
    this.goToView('enrolling');
  }

  async confirm(): Promise<void> {
    this.confirmForm.markAllAsTouched();
    if (this.confirmForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const result = await this.authService.confirmTwoFactor(this.confirmForm.getRawValue().code);
    if (!result.ok) {
      this.busy.set(false);
      this.error.set(
        result.failure.status === 429
          ? 'Too many attempts. Try again shortly.'
          : 'That code is incorrect or expired. Try again.',
      );
      return;
    }
    await this.refreshSession();
    this.busy.set(false);
    this.confirmForm.reset();
    this.goToView('done');
  }

  async disable(): Promise<void> {
    this.disableForm.markAllAsTouched();
    if (this.disableForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const result = await this.authService.disableTwoFactor(this.disableForm.getRawValue().password);
    if (!result.ok) {
      this.busy.set(false);
      this.error.set(this.failureMessage(result.failure.status));
      return;
    }
    await this.refreshSession();
    this.busy.set(false);
    this.disableForm.reset();
    this.goToView('start');
  }

  /** Switch view and move focus to the section so a screen reader is not stranded. */
  private goToView(view: View): void {
    this.view.set(view);
    queueMicrotask(() => this.sectionEl()?.nativeElement.focus());
  }

  /** Re-resolve the session so `AuthStore.twoFactorEnabled` reflects the change. */
  private async refreshSession(): Promise<void> {
    const user = await this.authService.getSession();
    // Defensive mirror of the login gate (finding AD6): every session commit
    // site carries the same rule so none of them can become the way back in.
    if (user && isStaff(user)) this.authStore.setSession({ user });
  }

  private failureMessage(status: number): string {
    if (status === 429) return 'Too many attempts. Try again shortly.';
    if (status === 401 || status === 403) return 'That password is incorrect.';
    return 'Something went wrong. Please try again.';
  }
}

/** Pull the shared secret out of an `otpauth://` enrolment URI. */
function extractSecret(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}
