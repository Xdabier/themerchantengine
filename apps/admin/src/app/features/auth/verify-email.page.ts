import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

/**
 * Email-verification landing page.
 *
 * Better Auth's verification link points straight at the API's
 * `GET /v1/auth/verify-email` endpoint, which marks the address verified and
 * then redirects the browser to this page (the configured `callbackURL`) — on
 * failure with an `?error=` query param. This page therefore only resolves the
 * result of that redirect; it does not itself call a verify endpoint.
 *
 * Admin staff are created with `emailVerified: true` (an operator vouches for
 * the staff they add), so this is reached only when a verification email was
 * explicitly sent — never as a sign-up gate.
 */
@Component({
  selector: 'app-verify-email-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen flex items-center justify-center bg-surface text-ink p-6">
      <div class="max-w-md w-full" data-testid="verify-email-page">
        @if (verified()) {
          <h1
            class="text-4xl md:text-5xl font-bold tracking-tight"
            data-testid="verify-email-success"
          >
            Email verified
          </h1>
          <p class="mt-4 text-sm text-ink-muted">
            Your email address is confirmed. You can sign in to the dashboard.
          </p>
        } @else {
          <h1
            class="text-4xl md:text-5xl font-bold tracking-tight"
            data-testid="verify-email-error"
          >
            Verification failed
          </h1>
          <p class="mt-4 text-sm text-ink-muted">
            This verification link is invalid or has expired. Sign in and request a fresh link from
            there.
          </p>
        }

        <a
          routerLink="/auth/login"
          class="mt-8 inline-block text-ink text-xs tracking-widest uppercase border-b border-ink pb-1"
          data-testid="verify-email-login-link"
        >
          Go to sign in
        </a>
      </div>
    </main>
  `,
})
export class VerifyEmailPage {
  private readonly route = inject(ActivatedRoute);

  /** Better Auth appends `?error=` to the callback URL when verification fails. */
  private readonly errorParam = toSignal(
    this.route.queryParams.pipe(map((q) => q['error'] ?? null)),
    { initialValue: null },
  );

  readonly verified = computed(() => !this.errorParam());
}
