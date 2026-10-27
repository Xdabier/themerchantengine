import { Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CUSTOMER_SEGMENTATION_QUEUE,
  CUSTOMER_SEGMENTATION_JOB,
  CUSTOMER_SEGMENTATION_CRON,
} from '../users.constants';

/**
 * Daily BullMQ processor that recomputes customer segment tags (spec §04).
 *
 * Segments are derived from order history and stored as a `segment` tag
 * in the audit log / notification layer. No schema change needed — the
 * endpoint returns computed counts. This job logs the daily snapshot.
 */
@Processor(CUSTOMER_SEGMENTATION_QUEUE)
export class CustomerSegmentationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CustomerSegmentationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CUSTOMER_SEGMENTATION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      CUSTOMER_SEGMENTATION_JOB,
      {},
      { repeat: { pattern: CUSTOMER_SEGMENTATION_CRON }, jobId: 'customer-segmentation-cron' },
    );
    this.logger.log('onModuleInit: customer-segmentation cron registered (daily 03:00)');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async process(_job: Job): Promise<void> {
    this.logger.log('process: recomputing customer segments');

    const now = new Date();
    const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const days90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const days180 = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const days365 = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const [newCount, activeCount, loyalCount, atRiskCount, churnedCount] =
      await this.prisma.$transaction([
        this.prisma.user.count({
          where: { role: 'CUSTOMER', createdAt: { gte: days30 }, orders: { none: {} } },
        }),
        this.prisma.user.count({
          where: { role: 'CUSTOMER', orders: { some: { createdAt: { gte: days90 } } } },
        }),
        this.prisma.user.count({
          where: {
            role: 'CUSTOMER',
            createdAt: { lt: days30 },
            orders: { some: { status: 'DELIVERED' } },
          },
        }),
        this.prisma.user.count({
          where: {
            role: 'CUSTOMER',
            orders: {
              some: { createdAt: { gte: days365 } },
              none: { createdAt: { gte: days180 } },
            },
          },
        }),
        this.prisma.user.count({
          where: {
            role: 'CUSTOMER',
            orders: { some: {}, none: { createdAt: { gte: days365 } } },
          },
        }),
      ]);

    this.logger.log(
      `process: done — NEW=${newCount} ACTIVE=${activeCount} LOYAL=${loyalCount} AT_RISK=${atRiskCount} CHURNED=${churnedCount}`,
    );
  }
}
