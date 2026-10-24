import { Injectable, inject } from '@angular/core';
import { adminSessionUserSchema, type AdminSessionUser } from '@admin-types';
import { ADMIN_AUTH_CLIENT } from './auth-client';
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  magicLinkRequestSchema,
  resetPasswordRequestSchema,
  totpCodeSchema,
  type ForgotPasswordRequest,
  type LoginRequest,
  type MagicLinkRequest,
  type ResetPasswordRequest,
} from './auth.schemas';

/**
 * Angular wrapper over the Better Auth client (DR-24).
 *
 * Authentication + sessions are owned by Better Auth: the session is one
 * `HttpOnly` cookie, never a JavaScript-readable token (constitution §3.3 /
 * §3.10). This service is a thin, typed surface over the vanilla client — it
 * never touches `HttpClient`, so the admin interceptor chain does not apply to
 * auth calls. The `module:action` RBAC the admin gates on rides the session
 * via the backend `customSession` plugin (§3.15-C), so `getSession()` resolves
 * a complete `AdminUser` in a single round-trip.
 *
 * Every method returns a discriminated result rather than throwing — the auth
 * screens branch on it for isolated, per-field error display (§3.10).
 */

/** A failed auth call, normalised from the Better Auth client error object. */
export interface AuthFailure {
  /** Better Auth error code (e.g. `INVALID_EMAIL_OR_PASSWORD`); null when absent. */
  code: string | null;
  /** HTTP status of the failed call. 0 for a network failure. */
  status: number;
  /** Raw message — for logging / fallback display, not a user-facing string. */
  message: string;
}

/** Result of a sign-in attempt. */
export type SignInResult =
  | { status: 'authenticated' }
  | { status: 'two-factor-required' }
  | { status: 'failed'; failure: AuthFailure };

/** Result of a one-shot auth action (reset, magic-link, verify, …). */
export type AuthActionResult = { ok: true } | { ok: false; failure: AuthFailure };

/** Result of starting TOTP enrolment — carries the QR + backup codes. */
export type TwoFactorEnrolResult =
  | { ok: true; totpUri: string; backupCodes: string[] }
  | { ok: false; failure: AuthFailure };

/** Shape of the Better Auth client error object, narrowed defensively. */
interface ClientError {
  code?: string;
  status?: number;
  message?: string;
}

function toFailure(error: unknown): AuthFailure {
  const e = (error ?? {}) as ClientError;
  return {
    code: typeof e.code === 'string' ? e.code : null,
    status: typeof e.status === 'number' ? e.status : 0,
    message: typeof e.message === 'string' ? e.message : 'Unexpected error',
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(ADMIN_AUTH_CLIENT);

  /** The admin's own origin — Better Auth email links must land back here, not on the API host. */
  private origin(): string {
    return globalThis.location?.origin ?? '';
  }

  /**
   * Resolve the current session into a complete `AdminUser`, or `null` when
   * there is no usable session. Never throws and never clears anything: a
   * transient failure (network / 5xx) is indistinguishable from "logged out"
   * to the caller, which is exactly what constitution §3.15-C wants — the
   * bootstrap commits only on a non-null result and leaves the store untouched
   * otherwise.
   */
  async getSession(): Promise<AdminSessionUser | null> {
    const { data, error } = await this.client.getSession();
    if (error || !data || !data.user) return null;
    // `adminSessionUserSchema`, not `adminUserSchema`: the session payload
    // always carries the account role, and the callers gate the commit on it
    // (finding AD6). Parsing with the tolerant schema would strip the role and
    // hand every caller an unclassifiable user.
    const parsed = adminSessionUserSchema.safeParse(data.user);
    return parsed.success ? parsed.data : null;
  }

  /** Sign in with email + password. A 2FA-enrolled user yields `two-factor-required`. */
  async signIn(input: LoginRequest): Promise<SignInResult> {
    const body = loginRequestSchema.parse(input);
    const { data, error } = await this.client.signIn.email({
      email: body.email,
      password: body.password,
    });
    if (error) return { status: 'failed', failure: toFailure(error) };
    if (data && typeof data === 'object' && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      return { status: 'two-factor-required' };
    }
    return { status: 'authenticated' };
  }

  /** Complete a 2FA challenge mid-sign-in with a TOTP code. */
  async verifyTwoFactor(code: string): Promise<AuthActionResult> {
    const parsed = totpCodeSchema.parse(code);
    return this.attempt(() => this.client.twoFactor.verifyTotp({ code: parsed }));
  }

  /** Sign out — revokes the server session. The caller clears `AuthStore` + navigates. */
  async signOut(): Promise<void> {
    try {
      await this.client.signOut();
    } catch {
      // Best-effort: a failed sign-out call must not strand the user; the local
      // store is cleared by the caller regardless.
    }
  }

  /** Request a password-reset email. Enumeration-safe — the backend always 200s. */
  async requestPasswordReset(input: ForgotPasswordRequest): Promise<AuthActionResult> {
    const body = forgotPasswordRequestSchema.parse(input);
    return this.attempt(() =>
      this.client.requestPasswordReset({
        email: body.email,
        redirectTo: `${this.origin()}/auth/reset`,
      }),
    );
  }

  /** Consume a reset token and set a new password. */
  async resetPassword(input: ResetPasswordRequest): Promise<AuthActionResult> {
    const body = resetPasswordRequestSchema.parse(input);
    return this.attempt(() =>
      this.client.resetPassword({ newPassword: body.password, token: body.token }),
    );
  }

  /** Email a one-time magic sign-in link. */
  async sendMagicLink(input: MagicLinkRequest): Promise<AuthActionResult> {
    const body = magicLinkRequestSchema.parse(input);
    return this.attempt(() =>
      this.client.signIn.magicLink({ email: body.email, callbackURL: `${this.origin()}/` }),
    );
  }

  /** Re-send the email-verification link to an unverified account. */
  async resendVerificationEmail(email: string): Promise<AuthActionResult> {
    const parsed = forgotPasswordRequestSchema.parse({ email });
    return this.attempt(() =>
      this.client.sendVerificationEmail({
        email: parsed.email,
        callbackURL: `${this.origin()}/auth/verify-email`,
      }),
    );
  }

  /** Begin TOTP 2FA enrolment — returns the `otpauth://` URI + backup codes. */
  async enableTwoFactor(password: string): Promise<TwoFactorEnrolResult> {
    try {
      const { data, error } = await this.client.twoFactor.enable({ password });
      if (error) return { ok: false, failure: toFailure(error) };
      const totpUri = typeof data?.totpURI === 'string' ? data.totpURI : '';
      const backupCodes = Array.isArray(data?.backupCodes) ? data.backupCodes : [];
      return { ok: true, totpUri, backupCodes };
    } catch (err) {
      return { ok: false, failure: toFailure(err) };
    }
  }

  /** Confirm a fresh TOTP enrolment with the first generated code. */
  async confirmTwoFactor(code: string): Promise<AuthActionResult> {
    const parsed = totpCodeSchema.parse(code);
    return this.attempt(() => this.client.twoFactor.verifyTotp({ code: parsed }));
  }

  /** Disable TOTP 2FA — requires the current password. */
  async disableTwoFactor(password: string): Promise<AuthActionResult> {
    return this.attempt(() => this.client.twoFactor.disable({ password }));
  }

  /** Run a Better Auth client call, normalising its `{ error }` and any throw. */
  private async attempt(
    fn: () => Promise<{ error?: unknown } | undefined>,
  ): Promise<AuthActionResult> {
    try {
      const result = await fn();
      if (result && result.error) return { ok: false, failure: toFailure(result.error) };
      return { ok: true };
    } catch (err) {
      return { ok: false, failure: toFailure(err) };
    }
  }
}
