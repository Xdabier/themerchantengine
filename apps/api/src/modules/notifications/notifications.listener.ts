import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { EVENT_NOTIFICATION_MAP, NOTIFICATION_TEMPLATES } from './notifications.constants';

/**
 * Bridges internal EventEmitter2 events to admin notifications.
 * Listens to: order.created, inventory.low_stock, inventory.out_of_stock,
 * review.created, return.created — the exact event names emitted by the
 * source services.
 *
 * For each event, creates a notification for all active admin users with
 * the appropriate title, body, and metadata.
 *
 * Errors are caught and logged so that notification creation never
 * disrupts the originating business transaction.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('order.created', { async: true })
  async onOrderCreated(data: unknown) {
    await this.handleEvent('order.created', data);
  }

  @OnEvent('inventory.low_stock', { async: true })
  async onInventoryLowStock(data: unknown) {
    await this.handleEvent('inventory.low_stock', data);
  }

  @OnEvent('inventory.out_of_stock', { async: true })
  async onInventoryOutOfStock(data: unknown) {
    await this.handleEvent('inventory.out_of_stock', data);
  }

  @OnEvent('review.created', { async: true })
  async onReviewCreated(data: unknown) {
    await this.handleEvent('review.created', data);
  }

  @OnEvent('return.created', { async: true })
  async onReturnCreated(data: unknown) {
    await this.handleEvent('return.created', data);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async handleEvent(eventType: string, data: unknown): Promise<void> {
    try {
      const notificationType = EVENT_NOTIFICATION_MAP[eventType];
      if (!notificationType) {
        this.logger.warn(`No notification type mapped for event: ${eventType}`);
        return;
      }

      const template = NOTIFICATION_TEMPLATES[notificationType];
      if (!template) {
        this.logger.warn(`No template found for notification type: ${notificationType}`);
        return;
      }

      const body = template.bodyTemplate ? template.bodyTemplate(data) : undefined;

      await this.notificationsService.createForAllAdmins(
        notificationType,
        template.title,
        body,
        data as object,
      );

      this.logger.log(`Created ${notificationType} notifications from event: ${eventType}`);
    } catch (err) {
      this.logger.error(
        `Failed to handle event ${eventType}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
