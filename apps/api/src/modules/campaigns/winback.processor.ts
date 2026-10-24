/**
 * Scheduled win-back job (NE9, operator decision: win-back w/ coupon).
 *
 * Weekly, it materialises ONE system WINBACK Campaign per window (deduped by a
 * unique `windowKey`) targeting lapsed account customers (AT_RISK ∪ CHURNED) who
 * hold MARKETING consent, attaches the configured coupon, and hands it to the
 * campaign plane. Idempotent per window via the windowKey + the per-recipient
 * CampaignSend unique, so a re-run never re-sends.
 *
 * Requires a valid `WINBACK_COUPON_CODE` (the operator's win-back promotion); if
 * absent or not an active promotion the job logs + skips (win-back is "with
 * coupon" by decision, so no coupon ⇒ no send).
 */
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CampaignService } from './campaign.service';
import { WINBACK_QUEUE, WINBACK_JOB, WINBACK_CRON } from './campaigns.constants';
import { WINBACK_DEFAULT_SUBJECT, WINBACK_DEFAULT_BODY } from './winback-defaults';

/** ISO-8601 week stamp, e.g. "2026-W25" — the win-back idempotency window. */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

@Processor(WINBACK_QUEUE)
export class WinbackProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(WinbackProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly campaigns: CampaignService,
    @InjectQueue(WINBACK_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      WINBACK_JOB,
      {},
      { repeat: { pattern: WINBACK_CRON }, jobId: 'campaign-winback-cron' },
    );
    this.logger.log('onModuleInit: win-back cron registered (weekly Mon 09:00)');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async process(_job: Job): Promise<void> {
    const couponCode = this.config.get<string>('WINBACK_COUPON_CODE');
    if (!couponCode) {
      this.logger.log('process: skipped — no WINBACK_COUPON_CODE configured');
      return;
    }
    const valid = await this.campaigns.validateCoupon(couponCode).catch(() => null);
    if (!valid) {
      this.logger.warn(`process: skipped — WINBACK_COUPON_CODE "${couponCode}" is not active`);
      return;
    }

    const windowKey = `winback:${isoWeekKey(new Date())}`;
    const existing = await this.prisma.campaign.findFirst({ where: { windowKey } });
    if (existing) {
      this.logger.log(`process: skipped — win-back already run this window (${windowKey})`);
      return;
    }

    let campaign: { id: string };
    try {
      campaign = await this.prisma.campaign.create({
        data: {
          name: `Win-back ${windowKey}`,
          subject: WINBACK_DEFAULT_SUBJECT,
          body: WINBACK_DEFAULT_BODY,
          segment: 'LAPSED',
          couponCode,
          kind: 'WINBACK',
          status: 'SENDING',
          sentAt: new Date(),
          windowKey,
        },
      });
    } catch (err) {
      // A concurrent run won the windowKey unique race — benign, already started.
      if ((err as { code?: string }).code === 'P2002') {
        this.logger.log(`process: skipped — win-back window ${windowKey} created concurrently`);
        return;
      }
      throw err;
    }
    await this.campaigns.enqueueBatch(campaign.id);
    this.logger.log(`process: win-back campaign ${campaign.id} started (${windowKey})`);
  }
}
