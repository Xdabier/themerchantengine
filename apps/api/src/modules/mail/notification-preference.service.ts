/**
 * Per-user, per-category communication consent (NE7).
 *
 * Two consumers:
 *   1. `MailService.enqueue` — calls `resolveEmailConsent` for non-transactional
 *      flows. Opt-in is REQUIRED: an absent preference row (or a soft-deleted
 *      one, or no account at all) means NOT consented, so the LIFECYCLE/MARKETING
 *      flow is skipped until the customer opts in.
 *   2. The storefront preference center + the public unsubscribe endpoint —
 *      `getPreferences` / `updatePreferences` / `optOut`.
 *
 * Modular isolation (§3.1): reads the User table via the mail module's injected
 * PrismaService, never another module's service internals.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CONSENT_CATEGORIES, type ConsentCategory } from './mail.constants';
import {
  resolveUnsubscribeSecret,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe-token.util';
import { resolvePublicApiBase } from './public-api-url.util';

/** Per-channel consent for one category. */
export interface ChannelConsent {
  email: boolean;
  sms: boolean;
  push: boolean;
}

/** Full preference map the customer endpoints expose. */
export type PreferenceMap = Record<ConsentCategory, ChannelConsent>;

/** Partial update payload — only the supplied categories/channels change. */
export type PreferenceUpdate = Partial<Record<ConsentCategory, Partial<ChannelConsent>>>;

const ALL_OFF: ChannelConsent = { email: false, sms: false, push: false };

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Gate helper: does this recipient consent to EMAIL for this category?
   * Opt-in required — absent user / absent row / `email:false` → not consented.
   * Resolves the user by the ORIGINAL recipient email (the caller passes
   * `input.to`, never the dev-redirected address) so a staging redirect never
   * changes a consent decision. Returns the resolved `userId` (when the
   * recipient maps to an account) so the gate can mint the unsubscribe URL
   * without a second lookup.
   */
  async resolveEmailConsent(
    email: string,
    category: string,
  ): Promise<{ userId: string | null; consented: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return { userId: null, consented: false };

    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_category: { userId: user.id, category } },
      select: { email: true },
    });
    return { userId: user.id, consented: pref?.email === true };
  }

  /** Read the full consent map for the customer's own account. */
  async getPreferences(userId: string): Promise<PreferenceMap> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId, category: { in: [...CONSENT_CATEGORIES] } },
      select: { category: true, email: true, sms: true, push: true },
    });
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    const out = {} as PreferenceMap;
    for (const category of CONSENT_CATEGORIES) {
      const row = byCategory.get(category);
      out[category] = row ? { email: row.email, sms: row.sms, push: row.push } : { ...ALL_OFF };
    }
    return out;
  }

  /** Upsert the supplied categories/channels for the customer's own account. */
  async updatePreferences(userId: string, update: PreferenceUpdate): Promise<PreferenceMap> {
    for (const category of CONSENT_CATEGORIES) {
      const patch = update[category];
      if (!patch) continue;
      await this.setConsent(userId, category, patch);
    }
    return this.getPreferences(userId);
  }

  /**
   * Build the absolute API one-click unsubscribe URL for an email footer or
   * header. The send's `locale` rides along. It is NOT part of the signed
   * token: it only steers the GET redirect to the locale-prefixed storefront
   * page, so a French recipient lands on `/fr/account/preferences`.
   */
  buildUnsubscribeUrl(userId: string, category: string, locale: string): string {
    const base = resolvePublicApiBase(this.config);
    const token = signUnsubscribeToken(userId, category, this.secret());
    return `${base}/v1/unsubscribe?token=${encodeURIComponent(token)}&locale=${encodeURIComponent(locale)}`;
  }

  /**
   * Honour a one-click / footer unsubscribe: verify the token, flip the
   * category's email consent off. Idempotent. Returns the category so the GET
   * handler can redirect the customer to the right preference-center anchor;
   * `null` for an invalid token (caller maps to 400).
   */
  async optOut(token: string): Promise<{ category: string } | null> {
    const verified = verifyUnsubscribeToken(token, this.secret());
    if (!verified) return null;
    try {
      await this.setConsent(verified.userId, verified.category, { email: false });
    } catch (err) {
      // A still-valid token whose user was since hard-deleted would fail the
      // FK on upsert. Degrade to the invalid-token path (400 / redirect=invalid)
      // rather than 500 — there is nothing to opt out, and the account is gone.
      this.logger.warn(
        `unsubscribe: opt-out failed for userId=${verified.userId}: ${(err as Error).message}`,
      );
      return null;
    }
    this.logger.log(`unsubscribe: userId=${verified.userId} category=${verified.category}`);
    return { category: verified.category };
  }

  /** Upsert one category's channel flags (soft-delete-aware revive on update). */
  private async setConsent(
    userId: string,
    category: string,
    patch: Partial<ChannelConsent>,
  ): Promise<void> {
    await this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      // Revive a soft-deleted row on update so a re-opt-in clears deletedAt.
      update: { ...patch, deletedAt: null },
      create: { userId, category, ...ALL_OFF, ...patch },
    });
  }

  private secret(): string {
    return resolveUnsubscribeSecret(
      this.config.get<string>('UNSUBSCRIBE_TOKEN_SECRET') ??
        this.config.get<string>('BETTER_AUTH_SECRET'),
    );
  }
}
