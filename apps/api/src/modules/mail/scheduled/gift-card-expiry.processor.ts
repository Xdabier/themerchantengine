/**
 * Gift-card expiry reminder (NE8).
 *
 * A daily repeatable scan that nudges a customer once when their card is ~14 days
 * and again at ~3 days from `expiresAt`, while a balance remains. Each daily scan
 * catches a card as it crosses into a mark's day-bucket; a stable
 * `giftcard-expiry:<cardId>:<mark>` dedupe key is the safety net against scan
 * overlap / job retries. TRANSACTIONAL (the card is an owned monetary asset).
 *
 * Recipient + locale read via the mail module's injected PrismaService (§3.1).
 */
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail.service';
import { resolveLocale } from '../listeners/locale.util';
import { defaultMailLocale, type MailLocale } from '../mail.types';
import { buildRedemptionUrl } from '../dispatch/url.util';
import { formatMailDate } from '../mail-date.util';
import { storeMoney } from '@common/money';
import {
  GIFT_CARD_EXPIRY_QUEUE,
  GIFT_CARD_EXPIRY_JOB,
  GIFT_CARD_EXPIRY_CRON,
  GIFT_CARD_EXPIRY_MARKS,
} from './scheduled.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

@Processor(GIFT_CARD_EXPIRY_QUEUE)
export class GiftCardExpiryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(GiftCardExpiryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    @InjectQueue(GIFT_CARD_EXPIRY_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      GIFT_CARD_EXPIRY_JOB,
      {},
      { repeat: { pattern: GIFT_CARD_EXPIRY_CRON }, jobId: 'gift-card-expiry-cron' },
    );
    this.logger.log('onModuleInit: gift-card-expiry cron registered (daily 08:00)');
  }

  async process(): Promise<void> {
    const now = Date.now();
    let sent = 0;

    for (const mark of GIFT_CARD_EXPIRY_MARKS) {
      // The card crosses into this mark's day-bucket on exactly one daily scan.
      const lower = new Date(now + (mark - 1) * DAY_MS);
      const upper = new Date(now + mark * DAY_MS);

      const cards = await this.prisma.giftCard.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          currentBalance: { gt: 0 },
          expiresAt: { gt: lower, lte: upper },
        },
        select: {
          id: true,
          code: true,
          currentBalance: true,
          currency: true,
          recipientEmail: true,
          purchasedBy: true,
          expiresAt: true,
        },
      });

      for (const card of cards) {
        const { to, locale } = await this.resolveRecipient(card.recipientEmail, card.purchasedBy);
        if (!to) continue;

        await this.mail.enqueue('giftcard.expiry-reminder', {
          to,
          locale,
          variables: {
            code: card.code,
            balance: storeMoney.format(Number(card.currentBalance), card.currency),
            expiresOn: formatMailDate(card.expiresAt, locale),
            redemptionUrl: buildRedemptionUrl(this.config, locale, card.code),
          },
          dedupeKey: `giftcard-expiry:${card.id}:${mark}`,
        });
        sent++;
      }
    }

    this.logger.log(`process: gift-card expiry reminders enqueued=${sent}`);
  }

  /** Recipient = the gift recipient; fall back to the purchaser for a self-bought card. */
  private async resolveRecipient(
    recipientEmail: string | null,
    purchasedBy: string | null,
  ): Promise<{ to: string | null; locale: MailLocale }> {
    if (recipientEmail) {
      const user = await this.prisma.user.findUnique({
        where: { email: recipientEmail },
        select: { locale: true },
      });
      return { to: recipientEmail, locale: resolveLocale(user?.locale) };
    }
    if (purchasedBy) {
      const purchaser = await this.prisma.user.findUnique({
        where: { id: purchasedBy },
        select: { email: true, locale: true },
      });
      if (purchaser?.email) return { to: purchaser.email, locale: resolveLocale(purchaser.locale) };
    }
    return { to: null, locale: defaultMailLocale() };
  }
}
