import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@admin-ui/atoms/button/button.component';
import { FormFieldComponent } from '@admin-ui/atoms/form-field/form-field.component';
import { InputComponent } from '@admin-ui/atoms/input/input.component';
import { AuthService } from '@admin-services';
import { map } from 'rxjs';
import { isStaff } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';

/**
 * TOTP 2FA challenge — the second step of a sign-in for a 2FA-enrolled
 * operator (Scenario C). Reached when `LoginPage` receives a
 * `two-factor-required` result; Better Auth holds the partial-sign-in state
 * server-side, so this page only needs the 6-digit code.
 *
 * On a verified code the session is resolved with one `getSession()` and
 * committed atomically (§3.15-C), then the operator continues to `returnTo`.
 */
@Component({
  selector: 'app-two-factor-challenge-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="two-factor-form">
      <h1 class="text-5xl md:text-6xl font-bold tracking-tight">Verify it's you</h1>
      <p class="mt-4 text-ink-muted tracking-widest uppercase text-xs">Two-factor · admin</p>
      <p class="mt-6 text-sm text-ink-muted">Enter the 6-digit code from your authenticator app.</p>

      @if (error()) {
        <p
          class="mt-6 border border-status-error text-ink p-3 tabular text-xs"
          data-testid="two-factor-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-8 flex flex-col gap-5" novalidate>
        <app-form-field
          label="Authentication code"
          fieldId="totp-code"
          [error]="codeError()"
          [required]="true"
        >
          <app-input
            id="totp-code"
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
          [disabled]="form.invalid"
          [loading]="submitting()"
          data-testid="two-factor-submit"
        >
          Verify
        </app-button>
      </form>

      <a
        routerLink="/auth/login"
        class="mt-6 inline-block text-ink text-xs tracking-widest uppercase border-b border-ink pb-1"
      >
        Back to sign in
      </a>
    </div>
  `,
})
export class TwoFactorChallengePage {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly returnTo = toSignal(this.route.queryParams.pipe(map((q) => q['returnTo'] ?? null)), {
    initialValue: null,
  });

  readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  codeError(): string | null {
    const c = this.form.controls.code;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Enter your authentication code.';
    if (c.hasError('pattern')) return 'The code is 6 digits.';
    return null;
  }

  async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.submitting()) return;

    const { code } = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);

    const result = await this.authService.verifyTwoFactor(code);
    if (!result.ok) {
      this.submitting.set(false);
      this.error.set(
        result.failure.status === 429
          ? 'Too many attempts. Try again shortly.'
          : 'That code is incorrect or expired. Try again.',
      );
      return;
    }

    const user = await this.authService.getSession();
    this.submitting.set(false);
    if (!user || user.status !== 'active') {
      this.error.set('Sign-in could not be completed. Return to sign in and retry.');
      return;
    }
    // Defensive mirror of the login gate (finding AD6). A customer cannot
    // normally reach the 2FA challenge, but every session commit site carries
    // the same rule so none of them can become the way back in.
    if (!isStaff(user)) {
      this.error.set('This account does not have access to the admin dashboard.');
      return;
    }
    this.authStore.setSession({ user });
    void this.router.navigateByUrl(this.safeReturnTo(this.returnTo()));
  }

  /** Mirror of `LoginPage.safeReturnTo` — block open-redirect smuggling. */
  private safeReturnTo(raw: string | null): string {
    if (!raw || typeof raw !== 'string') return '/';
    if (!raw.startsWith('/')) return '/';
    if (raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/ /')) return '/';
    if (raw.includes('\\')) return '/';
    return raw;
  }
}
