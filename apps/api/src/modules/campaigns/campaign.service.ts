/**
 * Campaign service (NE9) — the marketing/broadcast plane's brain.
 *
 * Owns CRUD, coupon validation, audience resolution, the batched send loop, the
 * operator test-send, and per-campaign stats. The batch loop runs OUT of the
 * isolated `campaign` BullMQ queue (CampaignProcessor is a thin wrapper around
 * `processBatch`) so it never shares the transactional `mail` queue (Risk R9).
 *
 * Eligibility is the legal gate: a BROADCAST reaches confirmed, non-unsubscribed,
 * non-suppressed Subscribers (double opt-in = consent); a WINBACK reaches lapsed
 * account customers with MARKETING NotificationPreference consent. Every send
 * carries a per-recipient RFC 8058 one-click unsubscribe.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { isProduction } from '@common/env';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendClient, type ResendBatchItem } from '../mail/resend.client';
import { SuppressionService } from '../mail/suppression.service';
import { NotificationPreferenceService } from '../mail/notification-preference.service';
import { renderDraft } from '../mail/templates/render';
import { resolveLocale } from '../mail/listeners/locale.util';
import type { MailLocale } from '../mail/mail.types';
import {
  CAMPAIGN_QUEUE,
  CAMPAIGN_SEND_JOB,
  CAMPAIGN_BATCH_SIZE,
  type CampaignSegment,
} from './campaigns.constants';
import { buildSegmentUserWhere } from './segments';
import { signSubscriberUnsubscribeToken } from './newsletter-token.util';
import { resolveUnsubscribeSecret } from '../mail/unsubscribe-token.util';
import { resolvePublicApiBase } from '../mail/public-api-url.util';
import { storeMoney } from '@common/money';
import { resolveTranslatable } from '@common/interceptors';
import { SettingsService } from '../settings/settings.service';
import { resolveMailIdentity } from '../mail/config/mail-identity';
import { storefrontBaseUrl } from '../mail/config/public-hosts';
import { storeLocales } from '@common/locale';
import { defaultMailLocale } from '../mail/mail.types';
import { sanitizeTranslatableEmailHtml } from '@common/utils';

/**
 * Scrub an operator-authored campaign body before it is stored.
 *
 * The sibling notification-template path has sanitized on create, on update
 * and before preview since NE6; this one wrote the body verbatim. Both store
 * HTML that the same renderer mails out, and a campaign reaches the entire
 * subscriber list rather than one flow's recipients, so the looser of the two
 * was the wrong one. Constitution section 3.5 requires the scrub on rich text.
 */
function sanitizeCampaignBody(
  body: Partial<Record<MailLocale, string>>,
): Partial<Record<MailLocale, string>> {
  return sanitizeTranslatableEmailHtml(
    body as unknown as Record<string, string>,
  ) as unknown as Partial<Record<MailLocale, string>>;
}

/** The one non-money discount label, per locale. A locale with no entry takes the store default's. */
const FREE_SHIPPING_LABEL: Record<string, string> = {
  fr: 'livraison offerte',
  en: 'free shipping',
  ar: 'شحن مجاني',
};

export interface CampaignRecipient {
  email: string;
  locale: MailLocale;
  subscriberId: string | null;
  userId: string | null;
}

export interface CreateCampaignInput {
  name: string;
  subject: Record<string, string | undefined>;
  body: Record<string, string | undefined>;
  segment: CampaignSegment;
  couponCode?: string | null;
  scheduledAt?: string | null;
}

export type UpdateCampaignInput = Partial<CreateCampaignInput>;

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly resend: ResendClient,
    private readonly suppression: SuppressionService,
    private readonly preferences: NotificationPreferenceService,
    @InjectQueue(CAMPAIGN_QUEUE) private readonly queue: Queue,
    private readonly settings: SettingsService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────────────

  async create(input: CreateCampaignInput, createdById: string | null): Promise<unknown> {
    if (input.couponCode) await this.validateCoupon(input.couponCode);
    return this.prisma.campaign.create({
      data: {
        name: input.name,
        subject: input.subject,
        body: sanitizeCampaignBody(input.body),
        segment: input.segment,
        couponCode: input.couponCode ?? null,
        kind: 'BROADCAST',
        status: input.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        createdById,
      },
    });
  }

  async list(query: {
    page?: number;
    pageSize?: number;
    status?: string;
    kind?: string;
  }): Promise<{ data: unknown[]; meta: { page: number; pageSize: number; total: number } }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total } };
  }

  async findOne(id: string): Promise<unknown> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign "${id}" not found`);
    return campaign;
  }

  async update(id: string, input: UpdateCampaignInput): Promise<unknown> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign "${id}" not found`);
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new ConflictException({
        error: {
          code: 'CAMPAIGN_NOT_EDITABLE',
          message: `A ${campaign.status} campaign cannot be edited.`,
        },
      });
    }
    if (input.couponCode) await this.validateCoupon(input.couponCode);

    return this.prisma.campaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.subject !== undefined && { subject: input.subject }),
        ...(input.body !== undefined && { body: sanitizeCampaignBody(input.body) }),
        ...(input.segment !== undefined && { segment: input.segment }),
        ...(input.couponCode !== undefined && { couponCode: input.couponCode }),
        ...(input.scheduledAt !== undefined && {
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          status: input.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        }),
      },
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign "${id}" not found`);
    await this.prisma.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }

  // ── Coupon ────────────────────────────────────────────────────────────────

  /** Resolve a coupon code to an active, in-window promotion or throw 400. */
  async validateCoupon(couponCode: string): Promise<{ type: string; value: unknown }> {
    const now = new Date();
    const promo = await this.prisma.promotion.findFirst({
      where: {
        couponCode,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      select: { type: true, value: true },
    });
    if (!promo) {
      throw new BadRequestException({
        error: {
          code: 'CAMPAIGN_INVALID_COUPON',
          message: `Coupon "${couponCode}" is not an active promotion.`,
        },
      });
    }
    return promo;
  }

  /** Human-readable discount label for win-back / preview (e.g. "15%"). */
  private discountLabel(type: string, value: unknown, locale: MailLocale): string {
    const v = String(value ?? '');
    if (type === 'PERCENTAGE') return `${v}%`;
    if (type === 'FREE_SHIPPING')
      return FREE_SHIPPING_LABEL[locale] ?? FREE_SHIPPING_LABEL[defaultMailLocale()] ?? '';
    // FIXED_AMOUNT: a money value in the charte's display format, symbol after
    // the number. This returned the raw `String(value)` of a Prisma Decimal, so
    // the recipient read something like `15` with no unit; D4 gave it a unit and
    // D7 gives it the customer-facing shape.
    return storeMoney.format(v);
  }

  // ── Send orchestration ──────────────────────────────────────────────────

  /** Transition a DRAFT/SCHEDULED campaign to SENDING and seed the first batch. */
  async send(id: string): Promise<{ id: string; status: string }> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign "${id}" not found`);
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new ConflictException({
        error: {
          code: 'CAMPAIGN_NOT_SENDABLE',
          message: `A ${campaign.status} campaign cannot be sent.`,
        },
      });
    }
    if (campaign.couponCode) await this.validateCoupon(campaign.couponCode);

    // Atomic, WHERE-guarded transition so a double-click / retried POST enqueues
    // the send exactly once: only the call that flips DRAFT|SCHEDULED → SENDING
    // wins; a concurrent loser sees count 0 and 409s (idempotency, no double job).
    const transition = await this.prisma.campaign.updateMany({
      where: { id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { status: 'SENDING', sentAt: campaign.sentAt ?? new Date() },
    });
    if (transition.count === 0) {
      throw new ConflictException({
        error: {
          code: 'CAMPAIGN_NOT_SENDABLE',
          message: 'This campaign is already sending or sent.',
        },
      });
    }
    await this.enqueueBatch(id);
    return { id, status: 'SENDING' };
  }

  /** Enqueue one batch job onto the isolated campaign queue. */
  async enqueueBatch(campaignId: string): Promise<void> {
    await this.queue.add(CAMPAIGN_SEND_JOB, { campaignId });
  }

  /** Per-campaign send counts for the admin detail view. */
  async stats(id: string): Promise<Record<string, number>> {
    const rows = await this.prisma.campaignSend.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const out: Record<string, number> = { total: 0 };
    for (const r of rows) {
      out[r.status] = r._count._all;
      out.total += r._count._all;
    }
    return out;
  }

  /**
   * Process ONE batch (≤ CAMPAIGN_BATCH_SIZE) of a SENDING campaign. Idempotent:
   * recipients already in CampaignSend are skipped, and the batch send carries a
   * deterministic Resend idempotency key so a retry of the identical batch never
   * double-sends. Re-enqueues the next batch until the audience is exhausted.
   * Returns whether the campaign is now fully sent.
   */
  async processBatch(campaignId: string): Promise<{ done: boolean; sent: number }> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId } });
    if (!campaign || campaign.status !== 'SENDING') return { done: true, sent: 0 };

    const sentRows = await this.prisma.campaignSend.findMany({
      where: { campaignId },
      select: { recipient: true },
    });
    const alreadyHandled = new Set(sentRows.map((r) => r.recipient));

    const eligible = (await this.resolveRecipients(campaign)).filter(
      (r) => !alreadyHandled.has(r.email),
    );

    if (eligible.length === 0) {
      await this.prisma.campaign.updateMany({
        where: { id: campaignId, status: 'SENDING' },
        data: { status: 'SENT' },
      });
      this.logger.log(`campaign sent: id=${campaignId}`);
      return { done: true, sent: 0 };
    }

    const batch = eligible.slice(0, CAMPAIGN_BATCH_SIZE);

    // Suppression filter — record suppressed recipients so they exit the loop.
    const sendable: CampaignRecipient[] = [];
    for (const r of batch) {
      if (await this.suppression.isSuppressed(r.email)) {
        await this.recordSend(campaignId, r, 'suppressed', null, null);
      } else {
        sendable.push(r);
      }
    }

    if (sendable.length > 0) {
      const couponMeta = campaign.couponCode
        ? await this.validateCoupon(campaign.couponCode).catch(() => null)
        : null;
      const storeNameRaw = await this.settings.get<unknown>('storeName');
      const items: ResendBatchItem[] = sendable.map((r) =>
        this.buildBatchItem(campaign, r, couponMeta, resolveTranslatable(storeNameRaw, r.locale)),
      );
      const batchKey = `campaign:${campaignId}:${this.batchHash(sendable)}`;
      const result = await this.resend.sendBatch(items, { idempotencyKey: batchKey });
      await Promise.all(
        sendable.map((r, i) =>
          this.recordSend(campaignId, r, 'sent', result.ids[i] ?? null, batchKey),
        ),
      );
    }

    const remaining = eligible.length - batch.length;
    if (remaining > 0) {
      await this.enqueueBatch(campaignId);
      return { done: false, sent: sendable.length };
    }
    await this.prisma.campaign.updateMany({
      where: { id: campaignId, status: 'SENDING' },
      data: { status: 'SENT' },
    });
    this.logger.log(`campaign sent: id=${campaignId}`);
    return { done: true, sent: sendable.length };
  }

  /** Mark a campaign FAILED — called by the processor after final retry. */
  async markFailed(campaignId: string, reason: string): Promise<void> {
    // Guard on SENDING so a late failed retry never clobbers an already-SENT row.
    await this.prisma.campaign
      .updateMany({ where: { id: campaignId, status: 'SENDING' }, data: { status: 'FAILED' } })
      .catch(() => undefined);
    this.logger.error(`campaign failed: id=${campaignId} reason=${reason}`);
  }

  /**
   * Render a DRAFT campaign for every enabled locale (no send, no persist), the admin
   * composer's live preview. Omitted draft fields fall back to the saved row, so
   * an operator can preview the latest unsaved edits.
   */
  async preview(
    id: string,
    draft: {
      subject?: Record<string, string | undefined>;
      body?: Record<string, string | undefined>;
      sampleVariables?: Record<string, string>;
    },
  ): Promise<Record<MailLocale, { subject: string; html: string; text: string }>> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign "${id}" not found`);
    const couponMeta = campaign.couponCode
      ? await this.validateCoupon(campaign.couponCode).catch(() => null)
      : null;
    const subject = (draft.subject ?? campaign.subject) as Record<string, string>;
    // Sanitized here too, not only on the write paths: the preview's whole claim
    // is that it renders a draft byte for byte the way a send would, and an
    // unsanitized preview shows the operator markup the send will strip.
    const body = sanitizeCampaignBody(
      (draft.body ?? campaign.body) as Partial<Record<MailLocale, string>>,
    ) as Record<string, string>;

    const out = {} as Record<MailLocale, { subject: string; html: string; text: string }>;
    const storeNameRaw = await this.settings.get<unknown>('storeName');
    for (const locale of storeLocales.current().supportedLocales as readonly MailLocale[]) {
      const vars = {
        ...this.buildVars(campaign, locale, couponMeta),
        ...(draft.sampleVariables ?? {}),
      };
      out[locale] = renderDraft({
        subject,
        body,
        locale,
        variables: vars,
        storeName: resolveTranslatable(storeNameRaw, locale),
      });
    }
    return out;
  }

  /** The store name for a message locale, from the runtime config (DR-31). */
  private async storeName(locale: MailLocale): Promise<string> {
    return resolveTranslatable(await this.settings.get<unknown>('storeName'), locale);
  }

  /** Render + send a single test of the campaign to the operator's own inbox. */
  async sendTest(
    id: string,
    userId: string,
    locale: MailLocale,
  ): Promise<{ status: string; recipient: string }> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign "${id}" not found`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      throw new BadRequestException({
        error: { code: 'TEST_SEND_NO_RECIPIENT', message: 'Your account has no email on file.' },
      });
    }

    const couponMeta = campaign.couponCode
      ? await this.validateCoupon(campaign.couponCode).catch(() => null)
      : null;
    const vars = this.buildVars(campaign, locale, couponMeta);
    const rendered = renderDraft({
      subject: campaign.subject as Record<string, string>,
      body: campaign.body as Record<string, string>,
      locale,
      variables: vars,
      storeName: await this.storeName(locale),
    });
    await this.resend.send({
      from: this.from(),
      to: this.resolveRecipient(user.email),
      replyTo: resolveMailIdentity(this.config).replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: { 'X-Entity-Ref-ID': `campaign-test:${id}` },
    });
    return { status: 'sent', recipient: user.email };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Resolve the campaign's eligible recipients by kind + segment. */
  async resolveRecipients(campaign: {
    id: string;
    kind: string;
    segment: string;
  }): Promise<CampaignRecipient[]> {
    if (campaign.kind === 'WINBACK') {
      const where = buildSegmentUserWhere('LAPSED', new Date()) ?? {};
      const users = await this.prisma.user.findMany({
        where: {
          ...where,
          email: { not: '' },
          notificationPreferences: {
            some: { category: 'MARKETING', email: true, deletedAt: null },
          },
          // Cross-ledger consent (security M-1): a customer who unsubscribed from
          // the newsletter (Subscriber.unsubscribedAt) must not receive win-back,
          // even if their MARKETING preference still reads true.
          subscribers: { none: { unsubscribedAt: { not: null }, deletedAt: null } },
        },
        select: { id: true, email: true, locale: true },
      });
      return users.map((u) => ({
        email: u.email,
        locale: resolveLocale(u.locale),
        subscriberId: null,
        userId: u.id,
      }));
    }

    // BROADCAST — confirmed, non-unsubscribed subscribers (middleware filters
    // deletedAt). A segment-filtered broadcast additionally requires a linked
    // user matching the order-history segment.
    const segment = campaign.segment as CampaignSegment;
    const userWhere = buildSegmentUserWhere(segment, new Date());
    // Cross-ledger consent (security M-1): an account-linked subscriber whose
    // User opted out of MARKETING (NotificationPreference email:false) must be
    // excluded even though the subscriber row is still confirmed. Anonymous
    // subscribers (no userId) consent solely via confirmedAt.
    const notMarketingOptedOut = {
      notificationPreferences: { none: { category: 'MARKETING', email: false, deletedAt: null } },
    };
    const subscribers = await this.prisma.subscriber.findMany({
      where: {
        confirmedAt: { not: null },
        unsubscribedAt: null,
        // The middleware doesn't reach a relation filter, so soft-deleted users
        // are excluded explicitly when a segment narrows by the linked account.
        ...(userWhere
          ? { user: { is: { ...userWhere, deletedAt: null, ...notMarketingOptedOut } } }
          : {
              OR: [
                { userId: null },
                { user: { is: { deletedAt: null, ...notMarketingOptedOut } } },
              ],
            }),
      },
      select: { id: true, email: true, locale: true, userId: true },
    });
    return subscribers.map((s) => ({
      email: s.email,
      locale: resolveLocale(s.locale),
      subscriberId: s.id,
      userId: s.userId,
    }));
  }

  private buildBatchItem(
    campaign: { id: string; subject: unknown; body: unknown; couponCode: string | null },
    r: CampaignRecipient,
    couponMeta: { type: string; value: unknown } | null,
    storeNameForBatch: string,
  ): ResendBatchItem {
    const vars = this.buildVars(campaign, r.locale, couponMeta);
    const unsubscribeUrl = this.unsubscribeUrlFor(r);
    const rendered = renderDraft({
      subject: campaign.subject as Record<string, string>,
      body: campaign.body as Record<string, string>,
      locale: r.locale,
      variables: vars,
      unsubscribeUrl,
      storeName: storeNameForBatch,
    });
    return {
      from: this.from(),
      to: this.resolveRecipient(r.email),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        'X-Entity-Ref-ID': `campaign:${campaign.id}`,
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  /**
   * Template variables for a campaign body — couponCode, a localized discount
   * label, and the locale-prefixed shop URL. `couponMeta` is the promotion
   * resolved once per batch / test send (no per-recipient DB hit).
   */
  private buildVars(
    campaign: { couponCode: string | null },
    locale: MailLocale,
    couponMeta: { type: string; value: unknown } | null,
  ): Record<string, unknown> {
    return {
      couponCode: campaign.couponCode ?? '',
      discountLabel: couponMeta
        ? this.discountLabel(couponMeta.type, couponMeta.value, locale)
        : '',
      shopUrl: this.shopUrl(locale),
    };
  }

  private unsubscribeUrlFor(r: CampaignRecipient): string {
    if (r.subscriberId) {
      const apiBase = resolvePublicApiBase(this.config);
      const token = signSubscriberUnsubscribeToken(r.subscriberId, this.secret());
      return `${apiBase}/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}&locale=${encodeURIComponent(r.locale)}`;
    }
    // Account-customer win-back: opt out the MARKETING NotificationPreference.
    return this.preferences.buildUnsubscribeUrl(r.userId ?? '', 'MARKETING', r.locale);
  }

  private async recordSend(
    campaignId: string,
    r: CampaignRecipient,
    status: string,
    providerMessageId: string | null,
    dedupeKey: string | null,
  ): Promise<void> {
    await this.prisma.campaignSend.upsert({
      where: { campaignId_recipient: { campaignId, recipient: r.email } },
      update: { status, providerMessageId, dedupeKey },
      create: {
        campaignId,
        subscriberId: r.subscriberId,
        recipient: r.email,
        status,
        providerMessageId,
        dedupeKey,
      },
    });
  }

  private batchHash(recipients: CampaignRecipient[]): string {
    const sorted = recipients
      .map((r) => r.email)
      .sort()
      .join(',');
    return createHash('sha256').update(sorted).digest('hex').slice(0, 32);
  }

  private from(): string {
    return resolveMailIdentity(this.config).from;
  }

  private shopUrl(locale: MailLocale): string {
    return `${storefrontBaseUrl(this.config)}/${locale}`;
  }

  /** Dev-redirect override — mirrors MailService.resolveRecipient (Risk R11). */
  private resolveRecipient(to: string): string {
    const redirect = this.config.get<string>('MAIL_DEV_REDIRECT_TO');
    if (redirect && !isProduction()) return redirect;
    return to;
  }

  private secret(): string {
    return resolveUnsubscribeSecret(
      this.config.get<string>('UNSUBSCRIBE_TOKEN_SECRET') ??
        this.config.get<string>('BETTER_AUTH_SECRET'),
    );
  }
}
