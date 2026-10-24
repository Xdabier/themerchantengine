/**
 * Campaign batch worker (NE9) — drains the isolated `campaign` queue. A thin
 * wrapper around `CampaignService.processBatch` so the send loop stays unit-
 * testable without BullMQ. On the final retry of a failing batch the campaign is
 * marked FAILED; otherwise the error re-throws for BullMQ's backoff (the Resend
 * batch idempotency key dedupes the retry at the provider).
 */
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  CAMPAIGN_QUEUE,
  CAMPAIGN_RATE_LIMITER,
  CAMPAIGN_WORKER_CONCURRENCY,
} from './campaigns.constants';
import { CampaignService } from './campaign.service';

@Processor(CAMPAIGN_QUEUE, {
  concurrency: CAMPAIGN_WORKER_CONCURRENCY,
  limiter: { ...CAMPAIGN_RATE_LIMITER },
})
export class CampaignProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignProcessor.name);

  constructor(private readonly campaigns: CampaignService) {
    super();
  }

  async process(job: Job<{ campaignId: string }>): Promise<void> {
    const { campaignId } = job.data;
    try {
      await this.campaigns.processBatch(campaignId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = job.opts.attempts ?? 3;
      const isFinal = job.attemptsMade + 1 >= attempts;
      if (isFinal) {
        await this.campaigns.markFailed(campaignId, message);
        this.logger.error(
          `batch failed-final: campaignId=${campaignId} attempts=${job.attemptsMade + 1}/${attempts} err=${message}`,
        );
      } else {
        this.logger.warn(
          `batch failed-retrying: campaignId=${campaignId} attempt=${job.attemptsMade + 1}/${attempts} err=${message}`,
        );
      }
      throw err;
    }
  }
}
