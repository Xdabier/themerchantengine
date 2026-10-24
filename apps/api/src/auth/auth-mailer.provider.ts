import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../modules/mail/mail.service';
import type { MailLocale } from '../modules/mail/mail.types';
import { AuthMailer, registerAuthMailer } from './auth-mailer';
import { storefrontBaseUrl } from '../modules/mail/config/public-hosts';
import { resolveLocale } from '../modules/mail/listeners/locale.util';
import { defaultMailLocale } from '../modules/mail/mail.types';

/**
 * Concrete `AuthMailer` — bridges Better Auth's transactional callbacks to
 * the `MailService` enqueue pipeline. Keeps the indirection seam (`auth.ts`
 * is a module-level singleton mounted before the Nest router; it cannot
 * inject providers directly) so `getAuthMailer()` continues to work
 * unchanged.
 *
 * Locale resolution: Better Auth callbacks supply the user object, not the
 * request locale. We do a lazy `User.locale` lookup so the email speaks the
 * customer's preferred language, and fall back to the store default when the
 * row carries none, through the one shared resolver.
 *
 * Audit trail: `MailService.enqueue` writes the NotificationLog row in
 * `status='queued'` with `metadata.actionUrl` (non-prod only). The
 * processor then transitions the row to `sent` / `failed`. The e2e helper
 * `recentActionUrl()` (test/e2e/helpers.ts:182-197) keeps working because
 * the `templateCode` strings here are byte-for-byte identical to the
 * pre-Resend AuthMailerProvider.
 */
@Injectable()
export class AuthMailerProvider implements AuthMailer, OnModuleInit {
  private readonly logger = new Logger('AuthMailer');

  constructor(
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    registerAuthMailer(this);
  }

  async sendPasswordReset(to: string, url: string): Promise<void> {
    await this.enqueue('auth.password-reset', to, { actionUrl: url });
  }

  async sendVerificationEmail(to: string, url: string): Promise<void> {
    await this.enqueue('auth.email-verification', to, { actionUrl: url });
  }

  async sendMagicLink(to: string, url: string): Promise<void> {
    await this.enqueue('auth.magic-link', to, { actionUrl: url });
  }

  async sendChangeEmailVerification(
    toNew: string,
    url: string,
    currentEmail?: string,
  ): Promise<void> {
    await this.enqueue('auth.change-email-verification', toNew, {
      actionUrl: url,
      newEmail: toNew,
      ...(currentEmail ? { currentEmail } : {}),
    });
  }

  async sendDeleteAccountVerification(to: string, url: string): Promise<void> {
    await this.enqueue('auth.delete-account', to, { actionUrl: url });
  }

  async sendWelcome(to: string, firstName?: string): Promise<void> {
    const storefrontUrl = storefrontBaseUrl();
    await this.enqueue('customer.welcome', to, {
      storefrontUrl,
      ...(firstName ? { firstName } : {}),
    });
  }

  async sendEmailChangeAlert(oldEmail: string, newEmail: string): Promise<void> {
    await this.enqueue('auth.email-change-alert', oldEmail, { newEmail });
  }

  async sendTwoFactorOtp(to: string, otp: string): Promise<void> {
    // `otp` renders into the body; safeMetadata redacts it from the audit row (§3.7).
    await this.enqueue('auth.2fa-otp', to, { otp });
  }

  async sendTwoFactorEnabled(to: string): Promise<void> {
    await this.enqueue('auth.2fa-enabled', to, { securityUrl: this.accountSecurityUrl() });
  }

  async sendTwoFactorDisabled(to: string): Promise<void> {
    await this.enqueue('auth.2fa-disabled', to, { securityUrl: this.accountSecurityUrl() });
  }

  /** Storefront account landing — the "review your security" CTA target. */
  private accountSecurityUrl(): string {
    return `${storefrontBaseUrl()}/account`;
  }

  /**
   * Single funnel: resolve locale → enqueue. Auditing failures never block
   * the auth flow — the queue add itself is the source of truth; we log +
   * swallow any infrastructure error so a transient Redis blip doesn't
   * brick sign-in.
   */
  private async enqueue(
    code:
      | 'auth.password-reset'
      | 'auth.email-verification'
      | 'auth.magic-link'
      | 'auth.change-email-verification'
      | 'auth.delete-account'
      | 'auth.email-change-alert'
      | 'auth.2fa-otp'
      | 'auth.2fa-enabled'
      | 'auth.2fa-disabled'
      | 'customer.welcome',
    to: string,
    variables: Record<string, unknown>,
  ): Promise<void> {
    const locale = await this.resolveLocale(to);
    try {
      await this.mail.enqueue(code, {
        to,
        locale,
        variables,
        ...(typeof variables.actionUrl === 'string' ? { actionUrl: variables.actionUrl } : {}),
      });
    } catch (err) {
      this.logger.error(`enqueue failed: code=${code} recipient=${to}`, err as Error);
    }
  }

  /**
   * Look up the user's preferred locale by email. Better Auth's callbacks
   * supply the user object, but the lazy seam means we don't have it here —
   * a single DB read is acceptable since auth callbacks fire rarely.
   * Falls back to the store default when no row matches (e.g. a magic-link to
   * a not-yet-registered address), through the one shared resolver rather than
   * the inlined copy this file used to carry.
   */
  private async resolveLocale(email: string): Promise<MailLocale> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
        select: { locale: true },
      });
      return resolveLocale(user?.locale);
    } catch {
      return defaultMailLocale();
    }
  }
}
