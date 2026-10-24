import { Inject, Injectable } from '@angular/core';
import {
  customerUserSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  magicLinkRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  type CustomerUser,
  type ForgotPasswordRequest,
  type LoginRequest,
  type MagicLinkRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
} from '@storefront-types';
import {
  STOREFRONT_AUTH_CLIENT,
  storefrontAuthHeaders,
  type StorefrontAuthClient,
} from './auth-client';

/**
 * Storefront auth service — an Angular wrapper over the Better Auth client
 * (DR-24).
 *
 * Authentication + sessions are owned by Better Auth: the session is one
 * `HttpOnly` cookie, never a JavaScript-readable token (constitution §3.3 /
 * §3.11.6). This service is a thin, typed surface over the vanilla client — it
 * never touches `STOREFRONT_API_CLIENT`, so the SSR / browser transport layer
 * does not apply to auth calls. There is no `refresh()`: the cookie session
 * slides server-side via Better Auth's `updateAge`, so a page reload simply
 * still carries the cookie — the rotation chain the storefront used to run is
 * gone.
 *
 * Every method returns a discriminated result rather than throwing, so the
 * auth pages can branch on it for isolated, per-field error display (§3.11).
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

/** Result of a sign-in attempt. Storefront customers have no 2FA (Q3). */
export type SignInResult =
  | { status: 'authenticated'; user: CustomerUser }
  | { status: 'failed'; failure: AuthFailure };

/** Result of a one-shot auth action (register, reset, magic-link, …). */
export type AuthActionResult = { ok: true } | { ok: false; failure: AuthFailure };

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
  constructor(@Inject(STOREFRONT_AUTH_CLIENT) private readonly client: StorefrontAuthClient) {}

  /**
   * Resolve the current session into a `CustomerUser`, or `null` when there is
   * no usable session. Never throws and never clears anything: a transient
   * failure (network / 5xx) is indistinguishable from "logged out" to the
   * caller, which is exactly what constitution §3.15-C / §3.11.6 want — the
   * boot routine commits only on a non-null result and leaves state untouched
   * otherwise.
   */
  async getSession(): Promise<CustomerUser | null> {
    const { data, error } = await this.client.getSession();
    if (error || !data || !data.user) return null;
    const raw = data.user as Record<string, unknown>;
    // Better Auth's session `user` carries `image` (the model field mapped to
    // the `avatarUrl` column). Surface it as `avatarUrl` so the parsed
    // `CustomerUser` is semantically correct.
    const candidate = { ...raw, avatarUrl: raw['avatarUrl'] ?? raw['image'] ?? null };
    const parsed = customerUserSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Register a new customer. `requireEmailVerification` is on (clarification
   * Q2), so sign-up creates the account and sends a verification email but
   * does NOT establish a session — the page shows a "check your email" state.
   * `callbackURL` is the locale-aware storefront URL the verification link
   * lands on once `autoSignInAfterVerification` completes.
   */
  async register(
    input: RegisterRequest,
    callbackURL: string,
    bot?: { captchaToken?: string | null; honeypot?: string | null },
  ): Promise<AuthActionResult> {
    const body = registerRequestSchema.parse(input);
    // Bot-abuse hardening (2026-06-23): the Turnstile token rides the
    // `x-captcha-response` header the server captcha plugin verifies; the
    // honeypot (always sent, empty for real users) rides `x-hp-field`. Both are
    // headers, never body fields, so Better Auth's sign-up schema is untouched.
    const headers: Record<string, string> = { 'x-hp-field': bot?.honeypot ?? '' };
    if (bot?.captchaToken) headers['x-captcha-response'] = bot.captchaToken;
    return this.attempt(() =>
      this.client.signUp.email({
        email: body.email,
        password: body.password,
        name: `${body.firstName} ${body.lastName}`.trim(),
        firstName: body.firstName,
        lastName: body.lastName,
        callbackURL,
        fetchOptions: { headers: storefrontAuthHeaders(headers) },
      }),
    );
  }

  /**
   * Sign in with email + password. On success the Better Auth session cookie
   * is set; `getSession()` then resolves the customer so the caller commits a
   * complete `CustomerUser` to `AuthStateService` in one step (no separate
   * profile round-trip in the page).
   */
  async login(input: LoginRequest): Promise<SignInResult> {
    const body = loginRequestSchema.parse(input);
    const { error } = await this.client.signIn.email({
      email: body.email,
      password: body.password,
    });
    if (error) return { status: 'failed', failure: toFailure(error) };
    const user = await this.getSession();
    if (!user) {
      return {
        status: 'failed',
        failure: {
          code: 'SESSION_UNRESOLVED',
          status: 0,
          message: 'Sign-in succeeded but the session did not resolve.',
        },
      };
    }
    return { status: 'authenticated', user };
  }

  /** Sign out — revokes the server session. The caller clears AuthState + navigates. */
  async signOut(): Promise<void> {
    try {
      await this.client.signOut();
    } catch {
      // Best-effort: a failed sign-out call must not strand the user; the local
      // AuthState is cleared by the caller regardless.
    }
  }

  /** Request a password-reset email. Enumeration-safe — the backend always 200s. */
  async forgotPassword(
    input: ForgotPasswordRequest,
    redirectTo: string,
  ): Promise<AuthActionResult> {
    const body = forgotPasswordRequestSchema.parse(input);
    return this.attempt(() => this.client.requestPasswordReset({ email: body.email, redirectTo }));
  }

  /** Consume a reset token and set a new password. */
  async resetPassword(input: ResetPasswordRequest): Promise<AuthActionResult> {
    const body = resetPasswordRequestSchema.parse(input);
    return this.attempt(() =>
      this.client.resetPassword({ newPassword: body.password, token: body.token }),
    );
  }

  /** Email a one-time magic sign-in link (clarification Q3 — customer scope). */
  async sendMagicLink(input: MagicLinkRequest, callbackURL: string): Promise<AuthActionResult> {
    const body = magicLinkRequestSchema.parse(input);
    return this.attempt(() => this.client.signIn.magicLink({ email: body.email, callbackURL }));
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
