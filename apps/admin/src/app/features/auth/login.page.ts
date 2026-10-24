import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import { AuthService, type AuthFailure } from '@admin-services';
import { isStaff } from '@admin-types';
import { map } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';

type Mode = 'password' | 'magic-link';

/**
 * Admin sign-in page (Better Auth — DR-24).
 *
 * Two modes on one form:
 * - **password** — email + password → `signIn()`. A 2FA-enrolled operator is
 *   routed to the TOTP challenge; an unverified account is offered a resend.
 * - **magic-link** — email only → `sendMagicLink()` emails a one-time link.
 *
 * On a completed sign-in the session is resolved with one `getSession()` and
 * committed to `AuthStore` atomically (§3.15-C), then the operator is sent to
 * the sanitised `returnTo` or the dashboard. There is no access token —
 * authorization rides the `HttpOnly` session cookie.
 */
@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="login-form">
      <h1 class="flex items-center gap-4 text-4xl md:text-5xl font-bold tracking-tight uppercase">
        <span aria-hidden="true" class="inline-block w-5 h-5 bg-brand-mark shrink-0"></span>
        The Merchant Engine
      </h1>
      <p class="mt-4 text-ink-muted tracking-widest uppercase text-xs">
        {{ mode() === 'magic-link' ? 'Sign in · magic link' : 'Sign in · admin' }}
      </p>

      @if (reason() === 'session-expired') {
        <p
          class="mt-6 border border-status-warning text-ink p-3 tabular text-xs uppercase tracking-widest"
          data-testid="login-session-expired"
          role="alert"
        >
          Session expired. Sign in again.
        </p>
      }

      @if (notice()) {
        <p
          class="mt-6 border border-status-success text-ink p-3 tabular text-xs"
          data-testid="login-notice"
          role="status"
        >
          {{ notice() }}
        </p>
      }

      @if (error()) {
        <p
          class="mt-6 border border-status-error text-ink p-3 tabular text-xs"
          data-testid="login-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      @if (unverifiedEmail()) {
        <app-button
          type="button"
          variant="ghost"
          size="sm"
          [loading]="submitting()"
          (clicked)="resendVerification()"
          data-testid="login-resend-verification"
        >
          Resend verification email
        </app-button>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-8 flex flex-col gap-5" novalidate>
        <app-form-field
          label="Email"
          fieldId="login-email"
          [error]="emailError()"
          [required]="true"
        >
          <app-input
            id="login-email"
            type="email"
            formControlName="email"
            placeholder="admin@badii.studio"
            [invalid]="!!emailError()"
            [autocomplete]="'username'"
          ></app-input>
        </app-form-field>

        @if (mode() === 'password') {
          <app-form-field
            label="Password"
            fieldId="login-password"
            [error]="passwordError()"
            [required]="true"
          >
            <app-input
              id="login-password"
              type="password"
              formControlName="password"
              [invalid]="!!passwordError()"
              [autocomplete]="'current-password'"
            ></app-input>
          </app-form-field>
        }

        <app-button
          type="submit"
          variant="primary"
          size="md"
          [disabled]="submitDisabled()"
          [loading]="submitting()"
          data-testid="login-submit"
        >
          {{ mode() === 'magic-link' ? 'Send sign-in link' : 'Sign in' }}
        </app-button>
      </form>

      <app-button
        type="button"
        variant="ghost"
        size="sm"
        class="mt-4 inline-block"
        [ariaLabel]="
          mode() === 'magic-link' ? 'Switch to password sign-in' : 'Switch to magic-link sign-in'
        "
        (clicked)="toggleMode()"
        data-testid="login-toggle-mode"
      >
        {{ mode() === 'magic-link' ? 'Use a password instead' : 'Email me a sign-in link' }}
      </app-button>

      @if (mode() === 'password') {
        <a
          routerLink="/auth/forgot"
          class="mt-6 block text-ink text-xs tracking-widest uppercase border-b border-ink pb-1 w-fit"
          data-testid="forgot-link"
        >
          Forgot password
        </a>
      }
    </div>
  `,
})
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly reason = toSignal(this.route.queryParams.pipe(map((q) => q['reason'] ?? null)), {
    initialValue: null,
  });
  readonly returnTo = toSignal(this.route.queryParams.pipe(map((q) => q['returnTo'] ?? null)), {
    initialValue: null,
  });

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(1)]],
  });

  readonly mode = signal<Mode>('password');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly unverifiedEmail = signal<string | null>(null);

  /**
   * In magic-link mode only the email is required; the password field is hidden.
   *
   * This is a plain method, not a `computed()`: Reactive-Forms validity getters
   * read their backing signal through `untracked()`, so a `computed()` over
   * `form.invalid` registers no dependency edge and would memoize its initial
   * value (disabled) forever under zoneless CD. A method is re-evaluated on
   * every change-detection pass — the same pass the `app-input` `(input)` event
   * already schedules — so it always reflects live validity.
   */
  submitDisabled(): boolean {
    return this.mode() === 'magic-link' ? this.form.controls.email.invalid : this.form.invalid;
  }

  emailError(): string | null {
    const c = this.form.controls.email;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Email is required.';
    if (c.hasError('email')) return 'Enter a valid email address.';
    return null;
  }

  passwordError(): string | null {
    const c = this.form.controls.password;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Password is required.';
    return null;
  }

  toggleMode(): void {
    this.mode.set(this.mode() === 'password' ? 'magic-link' : 'password');
    this.error.set(null);
    this.notice.set(null);
    this.unverifiedEmail.set(null);
  }

  submit(): void {
    if (this.mode() === 'magic-link') {
      void this.submitMagicLink();
    } else {
      void this.submitPassword();
    }
  }

  private async submitPassword(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.submitting()) return;

    const { email, password } = this.form.getRawValue();
    this.beginSubmit();

    const result = await this.authService.signIn({ email, password });

    if (result.status === 'two-factor-required') {
      this.submitting.set(false);
      void this.router.navigate(['/auth/two-factor'], {
        queryParams: this.returnTo() ? { returnTo: this.returnTo() } : {},
      });
      return;
    }
    if (result.status === 'failed') {
      this.submitting.set(false);
      this.applyFailure(result.failure, email);
      return;
    }

    const user = await this.authService.getSession();
    this.submitting.set(false);
    if (!user) {
      this.error.set('Sign-in failed. Please try again.');
      return;
    }
    if (user.status !== 'active') {
      this.error.set('This account is deactivated. Contact an administrator.');
      return;
    }
    // Finding AD6: a customer with working credentials signed in here and got
    // the full shell. The message is specific on purpose — a generic "Sign-in
    // failed" after correct credentials is a lie, and it would be
    // indistinguishable from a transient outage.
    if (!isStaff(user)) {
      this.error.set('This account does not have access to the admin dashboard.');
      return;
    }
    this.authStore.setSession({ user });
    this.form.controls.password.reset('');
    void this.router.navigateByUrl(this.safeReturnTo(this.returnTo()));
  }

  private async submitMagicLink(): Promise<void> {
    this.form.controls.email.markAsTouched();
    if (this.form.controls.email.invalid || this.submitting()) return;

    const { email } = this.form.getRawValue();
    this.beginSubmit();

    const result = await this.authService.sendMagicLink({ email });
    this.submitting.set(false);
    if (result.ok) {
      this.notice.set('If that email has an account, a sign-in link is on the way.');
    } else if (result.failure.status === 429) {
      this.error.set('Too many requests. Please wait a moment and try again.');
    } else {
      this.error.set('Could not send the sign-in link. Please try again.');
    }
  }

  async resendVerification(): Promise<void> {
    const email = this.unverifiedEmail();
    if (!email || this.submitting()) return;
    this.submitting.set(true);
    const result = await this.authService.resendVerificationEmail(email);
    this.submitting.set(false);
    if (result.ok) {
      this.unverifiedEmail.set(null);
      this.error.set(null);
      this.notice.set('Verification email sent. Check your inbox.');
    } else {
      this.error.set('Could not resend the verification email. Please try again.');
    }
  }

  private beginSubmit(): void {
    this.submitting.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.unverifiedEmail.set(null);
  }

  private applyFailure(failure: AuthFailure, email: string): void {
    if (failure.status === 429) {
      this.error.set('Too many attempts. Please wait a moment and try again.');
      return;
    }
    if (failure.code === 'EMAIL_NOT_VERIFIED' || /verif/i.test(failure.message)) {
      this.unverifiedEmail.set(email);
      this.error.set('Your email address is not verified yet.');
      return;
    }
    if (failure.status === 0 || failure.status >= 500) {
      this.error.set('Sign-in failed. Please try again.');
      return;
    }
    this.error.set('Incorrect email or password.');
  }

  /**
   * Guard against open-redirect variants: `//evil`, `/\evil`, protocol-style
   * values (`javascript:`, `data:`), and any backslash smuggling since some
   * browser URL parsers treat `\` as `/`.
   */
  private safeReturnTo(raw: string | null): string {
    if (!raw || typeof raw !== 'string') return '/';
    if (!raw.startsWith('/')) return '/';
    if (raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/ /')) return '/';
    if (raw.includes('\\')) return '/';
    return raw;
  }
}
