import { Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { GEO_LLMS_TXT_CRON, GEO_LLMS_TXT_JOB, GEO_LLMS_TXT_QUEUE } from '../geo.constants';
import { GeoService } from '../geo.service';
import { resolvePublicBaseUrl } from '../../seo/site-url';

/**
 * BullMQ processor for llms.txt generation.
 *
 * Registers a 6-hour repeatable cron in onModuleInit.
 * Also triggered ad-hoc by GeoService.enqueueLlmsRegeneration() when
 * a product or category slug changes.
 */
@Processor(GEO_LLMS_TXT_QUEUE)
export class LlmsTxtProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(LlmsTxtProcessor.name);

  constructor(
    private readonly geoService: GeoService,
    private readonly config: ConfigService,
    @InjectQueue(GEO_LLMS_TXT_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      GEO_LLMS_TXT_JOB,
      {},
      { repeat: { pattern: GEO_LLMS_TXT_CRON }, jobId: 'llms-txt-cron' },
    );
    this.logger.log('onModuleInit: llms.txt cron registered (every 6 hours)');
  }

  async process(job: Job): Promise<void> {
    const siteUrl = resolvePublicBaseUrl(this.config);
    this.logger.log(`process: regenerating llms.txt + llms-full.txt (jobId=${job.id})`);

    try {
      // Regenerate both surfaces in the same job so the short-form index and
      // the comprehensive expansion stay coherent. A divergent state (one
      // updated, the other stale) would point AI inference at a stale
      // catalogue while the index advertised the up-to-date URL list.
      await Promise.all([
        this.geoService.regenerateLlmsTxt(siteUrl),
        this.geoService.regenerateLlmsFullTxt(siteUrl),
      ]);
      this.logger.log('process: llms.txt + llms-full.txt regenerated for all locales');
    } catch (err) {
      this.logger.error('process: regeneration failed', (err as Error).stack);
      throw err;
    }
  }
}
