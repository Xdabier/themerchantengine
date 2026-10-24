import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  DELIVERY_TIMEOUT_MS,
  MAX_DELIVERY_ATTEMPTS,
  RETRY_DELAYS_MS,
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_PAYLOAD_VERSION,
  WEBHOOK_SIGNATURE_HEADER,
} from '../webhooks.constants';
import { signPayload } from '../webhooks.utils';
import { WebhookDeliveryJobData, WebhooksService } from '../webhooks.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const { subscriptionId, deliveryId, eventId, eventType, occurredAt, data, attempt } = job.data;

    // Fetch subscription to get URL + secret; skip if deleted/deactivated
    const sub = await this.prisma.webhookSubscription.findUnique({
      where: { id: subscriptionId },
      select: { url: true, secret: true, isActive: true },
    });

    if (!sub || !sub.isActive) {
      this.logger.warn(
        `process: skipping delivery — subscription ${subscriptionId} inactive or deleted`,
      );
      return;
    }

    // Build and sign the payload
    const body = JSON.stringify({
      eventId,
      eventType,
      occurredAt,
      data,
      version: WEBHOOK_PAYLOAD_VERSION,
    });

    const signature = signPayload(body, sub.secret);

    // Attempt the HTTP POST
    let responseStatus: number | null = null;
    let responseBody = '';
    let succeeded = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      try {
        const response = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [WEBHOOK_SIGNATURE_HEADER]: signature,
            'X-Webhook-Event': eventType,
            'X-Webhook-EventId': eventId,
          },
          body,
          signal: controller.signal,
        });

        responseStatus = response.status;
        responseBody = await response.text().catch(() => '');
        succeeded = response.status >= 200 && response.status < 300;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      responseBody = (err as Error).message ?? 'Request failed';
    }

    if (succeeded) {
      await this.webhooksService.recordDeliverySuccess(
        deliveryId,
        subscriptionId,
        responseStatus!,
        responseBody,
      );
      this.logger.log(
        `process: delivered eventId=${eventId} type=${eventType} sub=${subscriptionId} status=${responseStatus}`,
      );
      return;
    }

    // ── Failure path ─────────────────────────────────────────────────────────

    const nextAttempt = attempt + 1;
    const delayMs = RETRY_DELAYS_MS[attempt - 1] as number | undefined; // index 0 = delay after attempt 1

    const nextRetryAt =
      nextAttempt <= MAX_DELIVERY_ATTEMPTS && delayMs !== undefined
        ? new Date(Date.now() + delayMs)
        : null;

    await this.webhooksService.recordDeliveryFailure(
      deliveryId,
      responseStatus,
      responseBody,
      nextRetryAt,
    );

    this.logger.warn(
      `process: delivery failed eventId=${eventId} sub=${subscriptionId} attempt=${attempt}/${MAX_DELIVERY_ATTEMPTS} status=${responseStatus ?? 'timeout'}`,
    );

    if (nextAttempt <= MAX_DELIVERY_ATTEMPTS && delayMs !== undefined) {
      // Schedule next attempt with the exact delay from the spec
      await this.webhooksService.scheduleRetry(job.data, delayMs, nextAttempt);
    } else {
      // All attempts exhausted — increment failure counter, possibly deactivate
      await this.webhooksService.handleDeliveryExhausted(subscriptionId);
    }
  }
}
