/**
 * Staff digests (NE8) — snapshot-on-cron roll-ups to all active ADMINs (O7).
 *
 * Two repeatable jobs on one queue:
 *  - ops-digest (daily 07:00): low-stock / out-of-stock / new-returns (24h) /
 *    reviews-awaiting-moderation counts. SKIPS the send entirely when every count
 *    is zero, so admins never get an "all clear" email.
 *  - kpi-digest (Mon 07:00): a light revenue / orders / AOV / new-customers
 *    summary for the past 7 days.
 *
 * Snapshot-on-cron (not event-accumulate) is the storm-proofing: the producer
 * reads current state once per period rather than buffering per-event, so no
 * debounce window or accumulator can double-send. A per-(admin, period) dedupe
 * key makes a cron retry a no-op. TRANSACTIONAL (internal staff mail), so the
 * NE7 consent gate — which keys on customer preference rows staff never have —
 * never skips it. Source data + recipients read via the mail module's injected
 * PrismaService (§3.1); the KPI figures are a deliberately light inline summary
 * (not the full AnalyticsService) to keep the mail module decoupled.
 */
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { OrderStatus, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail.service';
import { resolveLocale } from '../listeners/locale.util';
import { copyEntry } from '../templates/layout';
import { LOW_STOCK_THRESHOLD } from '../../inventory/inventory.constants';
import { storeMoney } from '@common/money';
import { adminBaseUrl } from '../config/public-hosts';

/**
 * The seven-day window the weekly KPI digest reports on.
 *
 * `la semaine écoulée` rather than `les 7 derniers jours`: the second reads as
 * a date range to a human but is a literal match for the scarcity phrasing the
 * brand floor forbids, so it costs every future copy audit a false positive on
 * a staff digest.
 */
const PERIOD_LABEL: Record<string, string> = {
  fr: 'la semaine écoulée',
  en: 'the past 7 days',
  ar: 'الأسبوع الماضي',
};
import {
  STAFF_DIGEST_QUEUE,
  STAFF_OPS_DIGEST_JOB,
  STAFF_KPI_DIGEST_JOB,
  STAFF_OPS_DIGEST_CRON,
  STAFF_KPI_DIGEST_CRON,
} from './scheduled.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

interface AdminRecipient {
  id: string;
  email: string | null;
  locale: string | null;
}

@Processor(STAFF_DIGEST_QUEUE)
export class StaffDigestProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(StaffDigestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    @InjectQueue(STAFF_DIGEST_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      STAFF_OPS_DIGEST_JOB,
      {},
      { repeat: { pattern: STAFF_OPS_DIGEST_CRON }, jobId: 'staff-ops-digest-cron' },
    );
    await this.queue.add(
      STAFF_KPI_DIGEST_JOB,
      {},
      { repeat: { pattern: STAFF_KPI_DIGEST_CRON }, jobId: 'staff-kpi-digest-cron' },
    );
    this.logger.log('onModuleInit: staff ops (daily 07:00) + kpi (Mon 07:00) crons registered');
  }

  async process(job: Job): Promise<void> {
    if (job.name === STAFF_OPS_DIGEST_JOB) return this.runOpsDigest();
    if (job.name === STAFF_KPI_DIGEST_JOB) return this.runKpiDigest();
  }

  private async runOpsDigest(): Promise<void> {
    const since24h = new Date(Date.now() - DAY_MS);
    const [lowStockCount, outOfStockCount, newReturnsCount, pendingReviewsCount] =
      await Promise.all([
        this.prisma.stockLevel.count({ where: { onHand: { gt: 0, lte: LOW_STOCK_THRESHOLD } } }),
        this.prisma.stockLevel.count({ where: { onHand: { lte: 0 } } }),
        this.prisma.return.count({ where: { createdAt: { gte: since24h } } }),
        this.prisma.review.count({ where: { status: ReviewStatus.PENDING } }),
      ]);

    if (lowStockCount + outOfStockCount + newReturnsCount + pendingReviewsCount === 0) {
      this.logger.log('ops-digest: nothing to report — skipped');
      return;
    }

    const admins = await this.admins();
    const adminUrl = this.adminUrl();
    const day = new Date().toISOString().slice(0, 10);

    for (const a of admins) {
      if (!a.email) continue;
      await this.mail.enqueue('admin.ops-digest', {
        to: a.email,
        locale: resolveLocale(a.locale),
        variables: {
          lowStockCount,
          outOfStockCount,
          newReturnsCount,
          pendingReviewsCount,
          adminUrl,
        },
        dedupeKey: `ops-digest:${a.id}:${day}`,
      });
    }
    this.logger.log(`ops-digest: enqueued to ${admins.length} admin(s)`);
  }

  private async runKpiDigest(): Promise<void> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [orderAgg, newCustomers] = await Promise.all([
      this.prisma.order.aggregate({
        _sum: { total: true },
        _count: { _all: true },
        where: {
          createdAt: { gte: since },
          status: { notIn: [OrderStatus.PENDING, OrderStatus.CANCELLED] },
        },
      }),
      this.prisma.user.count({
        where: { role: 'CUSTOMER', deletedAt: null, createdAt: { gte: since } },
      }),
    ]);

    const orders = orderAgg._count._all;
    const revenueNum = Number(orderAgg._sum.total ?? 0);
    const aovNum = orders > 0 ? revenueNum / orders : 0;

    const admins = await this.admins();
    const adminUrl = this.adminUrl();
    const weekBucket = Math.floor(Date.now() / (7 * DAY_MS));

    for (const a of admins) {
      if (!a.email) continue;
      const locale = resolveLocale(a.locale);
      await this.mail.enqueue('admin.kpi-digest', {
        to: a.email,
        locale,
        variables: {
          periodLabel: copyEntry(PERIOD_LABEL, locale),
          revenue: storeMoney.format(revenueNum),
          orders,
          aov: storeMoney.format(aovNum),
          newCustomers,
          adminUrl,
        },
        dedupeKey: `kpi-digest:${a.id}:${weekBucket}`,
      });
    }
    this.logger.log(`kpi-digest: enqueued to ${admins.length} admin(s)`);
  }

  private admins(): Promise<AdminRecipient[]> {
    return this.prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true, deletedAt: null },
      select: { id: true, email: true, locale: true },
    });
  }

  private adminUrl(): string {
    return adminBaseUrl(this.config);
  }
}
