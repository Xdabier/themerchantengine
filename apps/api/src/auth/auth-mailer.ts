/**
 * Indirection between the Better Auth instance and the NestJS `notifications`
 * module.
 *
 * `auth.ts` is a plain module-level singleton (it is mounted as raw Express
 * middleware, before the Nest router exists), so it cannot inject the
 * DI-managed `NotificationsService`. Better Auth's email callbacks — password
 * reset, email verification, magic link — therefore resolve the mailer lazily
 * through `getAuthMailer()`.
 *
 * The concrete `AuthMailer` (delegating to the notifications module) is
 * registered during Nest bootstrap via `registerAuthMailer()` — see BA2.16.
 */

/** Outbound auth emails. Implemented by the mail module (Resend rollout). */
export interface AuthMailer {
  /** Password-reset email — `url` carries the reset token. */
  sendPasswordReset(to: string, url: string): Promise<void>;
  /** Email-verification email — `url` carries the verification token. */
  sendVerificationEmail(to: string, url: string): Promise<void>;
  /** Magic-link sign-in email — `url` carries the magic-link token. */
  sendMagicLink(to: string, url: string): Promise<void>;
  /**
   * Change-email confirmation. `toNew` is the *new* address (the one being
   * proven). `currentEmail` (optional) is shown in the copy so the user sees
   * "from X to Y" context.
   */
  sendChangeEmailVerification?(toNew: string, url: string, currentEmail?: string): Promise<void>;
  /** Account-deletion confirmation. Goes to the user's current email. */
  sendDeleteAccountVerification?(to: string, url: string): Promise<void>;
  /** Post-verification welcome — fired by Better Auth's afterEmailVerification (NE5). */
  sendWelcome?(to: string, firstName?: string): Promise<void>;
  /**
   * Security alert to the OLD address when an email change is requested (NE5).
   * `newEmail` is shown so the owner sees what was requested; the change is not
   * yet applied (it waits on the new-address verification).
   */
  sendEmailChangeAlert?(oldEmail: string, newEmail: string): Promise<void>;
  /**
   * 2FA email-OTP second factor (NE8). `otp` is a single-use credential — it
   * renders into the email body but is redacted from the audit row and never
   * logged (constitution §3.7).
   */
  sendTwoFactorOtp?(to: string, otp: string): Promise<void>;
  /** 2FA enrolment confirmation — a security notice to the account owner (NE8). */
  sendTwoFactorEnabled?(to: string): Promise<void>;
  /** 2FA disabled confirmation — a security notice to the account owner (NE8). */
  sendTwoFactorDisabled?(to: string): Promise<void>;
}

let registeredMailer: AuthMailer | null = null;

/** Called once during Nest bootstrap by the notifications module. */
export function registerAuthMailer(mailer: AuthMailer): void {
  registeredMailer = mailer;
}

/**
 * Resolves the registered `AuthMailer`. Throws if called before bootstrap has
 * registered one — which cannot happen for a real request, since the
 * notifications module registers the mailer before the HTTP server listens.
 */
export function getAuthMailer(): AuthMailer {
  if (!registeredMailer) {
    throw new Error(
      'AuthMailer has not been registered — the notifications module must ' +
        'call registerAuthMailer() during bootstrap before any auth email is sent.',
    );
  }
  return registeredMailer;
}
