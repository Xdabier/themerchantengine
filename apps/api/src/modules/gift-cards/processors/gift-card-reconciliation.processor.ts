import { Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  GIFT_CARD_RECONCILIATION_QUEUE,
  GIFT_CARD_RECONCILIATION_JOB,
  GIFT_CARD_RECONCILIATION_CRON,
} from '../gift-cards.constants';

/**
 * Daily BullMQ processor that reconciles gift card balances (spec §10).
 *
 * Verifies that each card's `currentBalance` equals
 * `initialBalance + SUM(transactions.amount)`.
 * Discrepancies are logged as errors for manual investigation.
 */
@Processor(GIFT_CARD_RECONCILIATION_QUEUE)
export class GiftCardReconciliationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(GiftCardReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(GIFT_CARD_RECONCILIATION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      GIFT_CARD_RECONCILIATION_JOB,
      {},
      {
        repeat: { pattern: GIFT_CARD_RECONCILIATION_CRON },
        jobId: 'gift-card-reconciliation-cron',
      },
    );
    this.logger.log('onModuleInit: gift-card-reconciliation cron registered (daily 04:00)');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async process(_job: Job): Promise<void> {
    this.logger.log('process: starting gift card balance reconciliation');

    const cards = await this.prisma.giftCard.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        code: true,
        initialBalance: true,
        currentBalance: true,
        transactions: { select: { amount: true } },
      },
    });

    let ok = 0;
    let mismatch = 0;

    for (const card of cards) {
      const txSum = card.transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
      const expected = Number(card.initialBalance) + txSum;
      const actual = Number(card.currentBalance);

      // Allow 0.01 floating-point tolerance
      if (Math.abs(expected - actual) > 0.01) {
        mismatch++;
        this.logger.error(
          `reconciliation mismatch: card=${card.id} code=${card.code} ` +
            `expected=${expected.toFixed(2)} actual=${actual.toFixed(2)} ` +
            `drift=${(actual - expected).toFixed(2)}`,
        );
      } else {
        ok++;
      }
    }

    this.logger.log(`process: done — ok=${ok} mismatches=${mismatch} total=${cards.length}`);

    if (mismatch > 0) {
      throw new Error(
        `Gift card reconciliation: ${mismatch} balance mismatch(es) detected — see error logs`,
      );
    }
  }
}
