import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import { AuthService } from '@admin-services';
import { map } from 'rxjs';

const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

/**
 * Reset-password page (Better Auth — DR-24).
 *
 * Consumes the single-use token Better Auth emailed via the forgot-password
 * flow. The token travels in a query param (`?token=...`); it is never stored,
 * so a mid-flow refresh wipes it — matching the one-use server contract.
 *
 * The password policy mirrors `passwordPolicy` in
 * `libs/admin-services/src/auth/auth.schemas.ts` so client validation matches
 * the Zod parse before the network call.
 */
@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="reset-form">
      <h1 class="text-5xl md:text-6xl font-bold tracking-tight">Reset password</h1>
      <p class="mt-4 text-ink-muted tracking-widest uppercase text-xs">New credentials</p>

      @if (!token()) {
        <p
          class="mt-6 border border-status-warning text-ink p-3 tabular text-xs"
          data-testid="reset-missing-token"
          role="alert"
        >
          Missing or invalid reset token. Request a fresh link.
        </p>
        <a
          routerLink="/auth/forgot"
          class="mt-6 inline-block text-ink text-xs tracking-widest uppercase border-b border-ink pb-1"
        >
          New reset link
        </a>
      } @else if (done()) {
        <p
          class="mt-8 border border-status-success text-ink p-3 tabular text-xs"
          data-testid="reset-success"
          role="status"
        >
          Password updated. Redirecting to sign-in…
        </p>
      } @else {
        @if (error()) {
          <p
            class="mt-6 border border-status-error text-ink p-3 tabular text-xs"
            data-testid="reset-error"
            role="alert"
          >
            {{ error() }}
          </p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-8 flex flex-col gap-5" novalidate>
          <app-form-field
            label="New password"
            fieldId="reset-password"
            [error]="passwordError()"
            [hint]="'At least 8 characters with upper, lower, and a digit.'"
            [required]="true"
          >
            <app-input
              id="reset-password"
              type="password"
              formControlName="password"
              [invalid]="!!passwordError()"
              [autocomplete]="'new-password'"
            ></app-input>
          </app-form-field>

          <app-form-field
            label="Confirm password"
            fieldId="reset-password-confirm"
            [error]="confirmError()"
            [required]="true"
          >
            <app-input
              id="reset-password-confirm"
              type="password"
              formControlName="confirm"
              [invalid]="!!confirmError()"
              [autocomplete]="'new-password'"
            ></app-input>
          </app-form-field>

          <app-button
            type="submit"
            variant="primary"
            size="md"
            [disabled]="form.invalid"
            [loading]="submitting()"
            data-testid="reset-submit"
          >
            Update password
          </app-button>
        </form>
      }
    </div>
  `,
})
export class ResetPasswordPage {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly token = toSignal(this.route.queryParams.pipe(map((q) => q['token'] ?? null)), {
    initialValue: null,
  });

  readonly form = this.fb.nonNullable.group(
    {
      password: [
        '',
        [Validators.required, Validators.minLength(8), Validators.pattern(PASSWORD_POLICY)],
      ],
      confirm: ['', [Validators.required]],
    },
    { validators: [matchPasswords] },
  );

  readonly submitting = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  passwordError(): string | null {
    const c = this.form.controls.password;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Password is required.';
    if (c.hasError('minlength')) return 'Password must be at least 8 characters.';
    if (c.hasError('pattern')) return 'Must include upper, lower, and a digit.';
    return null;
  }

  confirmError(): string | null {
    const c = this.form.controls.confirm;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Confirm your new password.';
    if (this.form.hasError('mismatch')) return 'Passwords do not match.';
    return null;
  }

  async submit(): Promise<void> {
    this.form.markAllAsTouched();
    const tok = this.token();
    if (!tok || this.form.invalid || this.submitting()) return;

    const { password } = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);

    const result = await this.authService.resetPassword({ token: tok, password });
    this.submitting.set(false);

    if (result.ok) {
      this.done.set(true);
      // Hold long enough for a screen reader to announce the success message
      // before the redirect fires (a11y — polite live regions can debounce).
      setTimeout(() => {
        void this.router.navigate(['/auth/login']);
      }, 2500);
      return;
    }

    if (result.failure.status === 429) {
      this.error.set('Too many attempts. Try again shortly.');
    } else {
      this.error.set('Reset link is invalid or expired. Request a fresh one.');
    }
  }
}

function matchPasswords(control: AbstractControl): { mismatch: true } | null {
  const password = control.get('password')?.value;
  const confirm = control.get('confirm')?.value;
  if (!password || !confirm) return null;
  return password === confirm ? null : { mismatch: true };
}
