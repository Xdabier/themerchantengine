import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@admin-ui/atoms/button/button.component';
import { FormFieldComponent } from '@admin-ui/atoms/form-field/form-field.component';
import { InputComponent } from '@admin-ui/atoms/input/input.component';
import { AuthService } from '@admin-services';

/**
 * Forgot-password request form (Better Auth — DR-24).
 *
 * `requestPasswordReset()` is enumeration-safe — Better Auth does not reveal
 * whether the email matched an account — so the success copy never confirms
 * account existence.
 */
@Component({
  selector: 'app-forgot-password-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="forgot-form">
      <h1 class="text-5xl md:text-6xl font-bold tracking-tight">Forgot password</h1>
      <p class="mt-4 text-ink-muted tracking-widest uppercase text-xs">Reset link · email</p>

      @if (done()) {
        <p
          class="mt-8 border border-status-success text-ink p-3 tabular text-xs"
          data-testid="forgot-success"
          role="status"
        >
          If an account matches that email, a reset link is on the way. Check your inbox.
        </p>
      } @else {
        @if (error()) {
          <p
            class="mt-6 border border-status-error text-ink p-3 tabular text-xs"
            data-testid="forgot-error"
            role="alert"
          >
            {{ error() }}
          </p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-8 flex flex-col gap-5" novalidate>
          <app-form-field
            label="Email"
            fieldId="forgot-email"
            [error]="emailError()"
            [required]="true"
          >
            <app-input
              id="forgot-email"
              type="email"
              formControlName="email"
              placeholder="you@example.com"
              [invalid]="!!emailError()"
              [autocomplete]="'email'"
            ></app-input>
          </app-form-field>

          <app-button
            type="submit"
            variant="primary"
            size="md"
            [disabled]="form.invalid"
            [loading]="submitting()"
            data-testid="forgot-submit"
          >
            Send reset link
          </app-button>
        </form>
      }

      <a
        routerLink="/auth/login"
        class="mt-6 inline-block text-ink text-xs tracking-widest uppercase border-b border-ink pb-1"
      >
        Back to sign in
      </a>
    </div>
  `,
})
export class ForgotPasswordPage {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  readonly submitting = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  emailError(): string | null {
    const c = this.form.controls.email;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Email is required.';
    if (c.hasError('email')) return 'Enter a valid email address.';
    return null;
  }

  async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.submitting()) return;

    const { email } = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);

    const result = await this.authService.requestPasswordReset({ email });
    this.submitting.set(false);

    if (result.ok) {
      this.done.set(true);
    } else if (result.failure.status === 429) {
      this.error.set('Too many requests. Try again shortly.');
    } else {
      this.error.set('Could not send reset link. Please try again.');
    }
  }
}
