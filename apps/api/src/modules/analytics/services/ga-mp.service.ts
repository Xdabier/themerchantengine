import { Injectable, Logger } from '@nestjs/common';
import type { AnalyticsEvent } from '@prisma/client';

/**
 * Stub for Google Analytics Measurement Protocol (GA4) server-side forwarding.
 *
 * Implementation deferred — when the GA4 MP integration is shipped, this
 * service should POST to https://www.google-analytics.com/mp/collect with
 * the measurement ID and API secret from environment variables.
 *
 * @see https://developers.google.com/analytics/devguides/collection/protocol/ga4
 */
@Injectable()
export class GaMpService {
  private readonly logger = new Logger(GaMpService.name);

  /**
   * Forward a purchase event to the GA4 Measurement Protocol.
   * Currently logs the intent — HTTP call deferred.
   */
  async forwardPurchase(event: AnalyticsEvent, measurementId: string): Promise<void> {
    this.logger.log({
      msg: 'GA4 Measurement Protocol purchase forward (deferred — implementation pending)',
      eventId: event.id,
      orderId: event.orderId,
      measurementId,
    });
  }
}
