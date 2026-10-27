import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhooksService } from './webhooks.service';

/**
 * Bridges the internal EventEmitter2 event bus to outbound webhook deliveries.
 *
 * Every handler follows the same pattern:
 *  1. Receive the internal event payload from EventEmitter2.
 *  2. Call `webhooksService.dispatchEvent` which fans out to all active
 *     subscriptions for that event type.
 *
 * Errors are caught and logged so that a failing webhook dispatch never
 * disrupts the originating business transaction.
 */
@Injectable()
export class WebhooksListener {
  private readonly logger = new Logger(WebhooksListener.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  // ── Orders ──────────────────────────────────────────────────────────────────

  @OnEvent('order.created', { async: true })
  async onOrderCreated(data: unknown) {
    await this.dispatch('order.created', data);
  }

  @OnEvent('order.confirmed', { async: true })
  async onOrderConfirmed(data: unknown) {
    await this.dispatch('order.confirmed', data);
  }

  @OnEvent('order.status_changed', { async: true })
  async onOrderStatusChanged(data: unknown) {
    await this.dispatch('order.status_changed', data);
  }

  @OnEvent('order.cancelled', { async: true })
  async onOrderCancelled(data: unknown) {
    await this.dispatch('order.cancelled', data);
  }

  @OnEvent('order.shipped', { async: true })
  async onOrderShipped(data: unknown) {
    await this.dispatch('order.shipped', data);
  }

  @OnEvent('order.delivered', { async: true })
  async onOrderDelivered(data: unknown) {
    await this.dispatch('order.delivered', data);
  }

  // ── Products ─────────────────────────────────────────────────────────────────

  @OnEvent('product.created', { async: true })
  async onProductCreated(data: unknown) {
    await this.dispatch('product.created', data);
  }

  @OnEvent('product.updated', { async: true })
  async onProductUpdated(data: unknown) {
    await this.dispatch('product.updated', data);
  }

  @OnEvent('product.deleted', { async: true })
  async onProductDeleted(data: unknown) {
    await this.dispatch('product.deleted', data);
  }

  // ── Inventory ────────────────────────────────────────────────────────────────

  @OnEvent('inventory.low_stock', { async: true })
  async onInventoryLowStock(data: unknown) {
    await this.dispatch('inventory.low_stock', data);
  }

  @OnEvent('inventory.out_of_stock', { async: true })
  async onInventoryOutOfStock(data: unknown) {
    await this.dispatch('inventory.out_of_stock', data);
  }

  @OnEvent('inventory.restocked', { async: true })
  async onInventoryRestocked(data: unknown) {
    await this.dispatch('inventory.restocked', data);
  }

  // ── Customers ────────────────────────────────────────────────────────────────

  @OnEvent('customer.created', { async: true })
  async onCustomerCreated(data: unknown) {
    await this.dispatch('customer.created', data);
  }

  @OnEvent('customer.updated', { async: true })
  async onCustomerUpdated(data: unknown) {
    await this.dispatch('customer.updated', data);
  }

  // ── Cart ─────────────────────────────────────────────────────────────────────

  @OnEvent('cart.abandoned', { async: true })
  async onCartAbandoned(data: unknown) {
    await this.dispatch('cart.abandoned', data);
  }

  // ── Returns ──────────────────────────────────────────────────────────────────

  @OnEvent('return.created', { async: true })
  async onReturnRequested(data: unknown) {
    // External wire-format stays `return.requested` — webhook subscribers
    // registered against that event type, see webhooks.constants.ts.
    await this.dispatch('return.requested', data);
  }

  @OnEvent('return.approved', { async: true })
  async onReturnApproved(data: unknown) {
    await this.dispatch('return.approved', data);
  }

  @OnEvent('return.refunded', { async: true })
  async onReturnRefunded(data: unknown) {
    await this.dispatch('return.refunded', data);
  }

  // ── Reviews ──────────────────────────────────────────────────────────────────

  @OnEvent('review.created', { async: true })
  async onReviewSubmitted(data: unknown) {
    // External wire-format stays `review.submitted` for subscribers.
    await this.dispatch('review.submitted', data);
  }

  // ── Payments ─────────────────────────────────────────────────────────────────

  @OnEvent('payment.received', { async: true })
  async onPaymentReceived(data: unknown) {
    await this.dispatch('payment.received', data);
  }

  @OnEvent('payment.refunded', { async: true })
  async onPaymentRefunded(data: unknown) {
    await this.dispatch('payment.refunded', data);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async dispatch(eventType: string, data: unknown): Promise<void> {
    try {
      await this.webhooksService.dispatchEvent(eventType, data);
    } catch (err) {
      this.logger.error(
        `dispatch failed for ${eventType}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
