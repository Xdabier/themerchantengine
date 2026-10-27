import { Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import {
  GEO_CONTENT_FRESHNESS_CRON,
  GEO_CONTENT_FRESHNESS_JOB,
  GEO_CONTENT_FRESHNESS_QUEUE,
} from '../geo.constants';
import { GeoService } from '../geo.service';

/**
 * BullMQ processor for the daily content-freshness check.
 *
 * Registers a daily cron at 02:00 in onModuleInit.
 * Queries products, categories, and pages last updated > 90 days ago
 * and creates a CONTENT_STALE admin notification when any are found.
 */
@Processor(GEO_CONTENT_FRESHNESS_QUEUE)
export class ContentFreshnessProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ContentFreshnessProcessor.name);

  constructor(
    private readonly geoService: GeoService,
    @InjectQueue(GEO_CONTENT_FRESHNESS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      GEO_CONTENT_FRESHNESS_JOB,
      {},
      { repeat: { pattern: GEO_CONTENT_FRESHNESS_CRON }, jobId: 'content-freshness-cron' },
    );
    this.logger.log('onModuleInit: content-freshness cron registered (daily 02:00)');
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`process: running content freshness check (jobId=${job.id})`);

    try {
      const result = await this.geoService.checkContentFreshness();
      this.logger.log(
        `process: done — stale products=${result.staleProducts}, categories=${result.staleCategories}, pages=${result.stalePages}`,
      );
    } catch (err) {
      this.logger.error('process: content freshness check failed', (err as Error).stack);
      throw err;
    }
  }
}
