/**
 * Subscriber lifecycle (NE9) — newsletter signup, double opt-in confirmation,
 * one-click unsubscribe, and the admin subscriber list.
 *
 * Double opt-in (operator decision O5): `subscribe` creates an UNCONFIRMED row
 * and enqueues the `newsletter.confirm` transactional email; only `confirm`
 * (the signed-token click) sets `confirmedAt`, which a campaign batch requires.
 *
 * Modular isolation (§3.1): reads/writes its own tables via injected Prisma;
 * sends via the injected MailService (the established service bridge).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { resolveUnsubscribeSecret } from '../mail/unsubscribe-token.util';
import { resolvePublicApiBase } from '../mail/public-api-url.util';
import {
  signNewsletterConfirmToken,
  verifyNewsletterConfirmToken,
  verifySubscriberUnsubscribeToken,
} from './newsletter-token.util';
import { canonicalizeEmailForIdentity } from './email-identity.util';
import type { SubscriberLocale, SubscriberSource } from './campaigns.constants';
import { resolveLocale } from '../mail/listeners/locale.util';

export type SubscribeStatus = 'pending' | 'already-confirmed';

@Injectable()
export class SubscriberService {
  private readonly logger = new Logger(SubscriberService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /**
   * Newsletter signup. Idempotent + enumeration-safe: always reports a neutral
   * outcome to the caller (the controller returns the same 202 regardless).
   * Creates or revives an UNCONFIRMED row and (re)sends the confirm email; an
   * already-confirmed address is a silent no-op (no second confirm mail).
   */
  async subscribe(
    rawEmail: string,
    locale: SubscriberLocale,
    source: SubscriberSource,
  ): Promise<SubscribeStatus> {
    // Canonicalize the stored identity so Gmail dot/+tag variants of one inbox
    // collapse to a single row (and a stable mail dedupeKey). Non-Gmail domains
    // are only lowercased. See email-identity.util.ts.
    const rawNormalized = rawEmail.trim().toLowerCase();
    const email = canonicalizeEmailForIdentity(rawEmail);
    // Best-effort link to a registered customer: account emails are stored
    // un-canonicalized, so try the canonical identity first, then the raw form.
    const linkedUser =
      (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) ??
      (rawNormalized !== email
        ? await this.prisma.user.findUnique({
            where: { email: rawNormalized },
            select: { id: true },
          })
        : null);
    const userId = linkedUser?.id ?? null;

    // Active row (the middleware filters reads to deletedAt: null).
    const active = await this.prisma.subscriber.findUnique({ where: { email } });
    let subscriber: { id: string };

    if (active) {
      if (active.confirmedAt && !active.unsubscribedAt) return 'already-confirmed';
      // Pending or previously-unsubscribed: re-subscribe ⇒ require a fresh confirm.
      subscriber = await this.prisma.subscriber.update({
        where: { id: active.id },
        data: { locale, source, userId, confirmedAt: null, unsubscribedAt: null },
      });
    } else {
      // Revive a soft-deleted row (the unique email index spans deleted rows).
      const deleted = await this.prisma.subscriber.findFirst({
        where: { email, deletedAt: { not: null } },
      });
      subscriber = deleted
        ? await this.prisma.subscriber.update({
            where: { id: deleted.id },
            data: {
              locale,
              source,
              userId,
              deletedAt: null,
              confirmedAt: null,
              unsubscribedAt: null,
            },
          })
        : await this.prisma.subscriber.create({ data: { email, locale, source, userId } });
    }

    await this.sendConfirmEmail(subscriber.id, email, locale);
    return 'pending';
  }

  /** Confirm a double opt-in token. Idempotent; throws nothing on re-confirm. */
  async confirm(token: string): Promise<{ confirmed: boolean }> {
    const subscriberId = verifyNewsletterConfirmToken(token, this.secret());
    if (!subscriberId) return { confirmed: false };

    const subscriber = await this.prisma.subscriber.findUnique({ where: { id: subscriberId } });
    if (!subscriber) return { confirmed: false };

    if (!subscriber.confirmedAt || subscriber.unsubscribedAt) {
      await this.prisma.subscriber.update({
        where: { id: subscriberId },
        data: { confirmedAt: subscriber.confirmedAt ?? new Date(), unsubscribedAt: null },
      });
      this.logger.log(`confirm: subscriberId=${subscriberId}`);
    }
    return { confirmed: true };
  }

  /** Honour a subscriber one-click / footer unsubscribe. Idempotent. */
  async unsubscribeByToken(token: string): Promise<{ ok: boolean }> {
    const subscriberId = verifySubscriberUnsubscribeToken(token, this.secret());
    if (!subscriberId) return { ok: false };

    const subscriber = await this.prisma.subscriber.findUnique({ where: { id: subscriberId } });
    if (!subscriber) return { ok: false };

    if (!subscriber.unsubscribedAt) {
      await this.prisma.subscriber.update({
        where: { id: subscriberId },
        data: { unsubscribedAt: new Date() },
      });
      this.logger.log(`unsubscribe: subscriberId=${subscriberId}`);
    }
    return { ok: true };
  }

  /** Admin paginated subscriber list with status/source/search filters. */
  async list(query: {
    page?: number;
    pageSize?: number;
    status?: 'confirmed' | 'pending' | 'unsubscribed';
    source?: string;
    search?: string;
  }): Promise<{ data: unknown[]; meta: { page: number; pageSize: number; total: number } }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Record<string, unknown> = {};
    if (query.status === 'confirmed') {
      where.confirmedAt = { not: null };
      where.unsubscribedAt = null;
    } else if (query.status === 'pending') {
      where.confirmedAt = null;
      where.unsubscribedAt = null;
    } else if (query.status === 'unsubscribed') {
      where.unsubscribedAt = { not: null };
    }
    if (query.source) where.source = query.source;
    if (query.search) where.email = { contains: query.search.trim().toLowerCase() };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.subscriber.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.subscriber.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total } };
  }

  /** Admin manual opt-out / re-activate of a subscriber. */
  async setUnsubscribed(id: string, unsubscribed: boolean): Promise<unknown> {
    return this.prisma.subscriber.update({
      where: { id },
      data: { unsubscribedAt: unsubscribed ? new Date() : null },
    });
  }

  private async sendConfirmEmail(
    subscriberId: string,
    email: string,
    locale: SubscriberLocale,
  ): Promise<void> {
    const apiBase = resolvePublicApiBase(this.config);
    const token = signNewsletterConfirmToken(subscriberId, this.secret());
    const confirmUrl = `${apiBase}/v1/newsletter/confirm?token=${encodeURIComponent(token)}&locale=${encodeURIComponent(locale)}`;

    await this.mail.enqueue('newsletter.confirm', {
      to: email,
      locale: resolveLocale(locale),
      variables: { confirmUrl },
      actionUrl: confirmUrl,
      dedupeKey: `newsletter-confirm:${subscriberId}`,
    });
  }

  private secret(): string {
    return resolveUnsubscribeSecret(
      this.config.get<string>('UNSUBSCRIBE_TOKEN_SECRET') ??
        this.config.get<string>('BETTER_AUTH_SECRET'),
    );
  }
}
