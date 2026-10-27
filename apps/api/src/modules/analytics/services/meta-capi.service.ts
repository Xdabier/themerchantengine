import { Injectable, Logger } from '@nestjs/common';
import type { AnalyticsEvent } from '@prisma/client';

/**
 * Stub for Meta Conversions API (CAPI) server-side event forwarding.
 *
 * Implementation deferred — when the Meta CAPI integration is shipped, this
 * service should POST to https://graph.facebook.com/v18.0/{pixel-id}/events
 * using the configured access token from environment variables.
 *
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api
 */
@Injectable()
export class MetaCapiService {
  private readonly logger = new Logger(MetaCapiService.name);

  /**
   * Forward a purchase event to the Meta Conversions API.
   * Currently logs the intent — HTTP call deferred.
   */
  async forwardPurchase(event: AnalyticsEvent, pixelId: string): Promise<void> {
    this.logger.log({
      msg: 'Meta CAPI purchase forward (deferred — implementation pending)',
      eventId: event.id,
      orderId: event.orderId,
      pixelId,
    });
  }
}
