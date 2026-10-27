import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Inbound webhook dedup primitive (§9.5 I2, audit §1.12 BLOCKER #10).
 *
 * Wraps the existing `ProcessedWebhook` model
 * (`prisma/schema.prisma:1565-1573`) with a single upsert helper that
 * idempotently records the `(provider, externalEventId)` pair. The
 * payment webhook (`orders/payment-webhook.service.ts`) checks with
 * `isProcessed` first and records only after its side effect lands, so
 * a failed apply stays retryable.
 */
@Injectable()
export class ProcessedWebhookService {
  private readonly logger = new Logger(ProcessedWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isProcessed(provider: string, externalEventId: string): Promise<boolean> {
    const existing = await this.prisma.processedWebhook.findUnique({
      where: { provider_externalEventId: { provider, externalEventId } },
      select: { processedAt: true },
    });
    return existing !== null;
  }

  /**
   * Records (or replays) an inbound webhook event.
   *
   * Returns `{ alreadyProcessed: false, processedAt }` when the row was
   * inserted (first time we see the pair) and
   * `{ alreadyProcessed: true, processedAt }` when the row already
   * existed (the provider re-delivered the same event id within the
   * 30-day retention window — caller should NOT re-run side effects).
   *
   * Caller decides the retention window via the existing
   * `prisma.processedWebhook` cleanup job; this service does not
   * perform deletion.
   */
  async recordInboundEvent(
    provider: string,
    externalEventId: string,
    payload: Record<string, unknown>,
  ): Promise<{ alreadyProcessed: boolean; processedAt: Date }> {
    // `upsert` was specified in the task list (tasks.md E1.20). Prisma's
    // upsert against the @@unique([provider, externalEventId]) constraint
    // performs the dedup atomically — no race window between INSERT and
    // a follow-up SELECT — and a pre-existing row stays untouched
    // (`update: {}` is a no-op).
    const existing = await this.prisma.processedWebhook.findUnique({
      where: { provider_externalEventId: { provider, externalEventId } },
      select: { processedAt: true },
    });
    if (existing) {
      this.logger.log(
        `recordInboundEvent: provider="${provider}" eventId="${externalEventId}" status=replay`,
      );
      return { alreadyProcessed: true, processedAt: existing.processedAt };
    }

    const created = await this.prisma.processedWebhook.upsert({
      where: { provider_externalEventId: { provider, externalEventId } },
      update: {},
      create: { provider, externalEventId },
      select: { processedAt: true },
    });
    this.logger.log(
      `recordInboundEvent: provider="${provider}" eventId="${externalEventId}" status=new payloadKeys=${Object.keys(payload).length}`,
    );
    return { alreadyProcessed: false, processedAt: created.processedAt };
  }
}
