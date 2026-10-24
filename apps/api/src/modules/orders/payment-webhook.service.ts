import { Injectable } from '@nestjs/common';
import { PaymentGatewayService } from '../payments/payment-gateway.service';
import type { PaymentWebhookInput } from '../payments/providers/payment-provider.interface';
import { ProcessedWebhookService } from '../webhooks/processed-webhook.service';
import { OrdersService } from './orders.service';

@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly paymentGateway: PaymentGatewayService,
    private readonly processedWebhooks: ProcessedWebhookService,
    private readonly orders: OrdersService,
  ) {}

  // Verify, dedup, apply, then record. Recording last keeps a failed apply
  // retryable; the apply is a no-op on a repeat, so a racing duplicate is safe.
  async process(
    providerId: string,
    headers: PaymentWebhookInput['headers'],
    rawBody: Buffer,
  ): Promise<{ ok: true; replay: boolean }> {
    const { event, methodCodes } = await this.paymentGateway.parseWebhook(
      providerId,
      headers,
      rawBody,
    );
    const dedupKey = `payments:${providerId}`;

    if (await this.processedWebhooks.isProcessed(dedupKey, event.eventId)) {
      return { ok: true, replay: true };
    }

    await this.orders.applyPaymentWebhookEvent(providerId, event, methodCodes);
    await this.processedWebhooks.recordInboundEvent(dedupKey, event.eventId, {
      reference: event.reference,
      status: event.status,
    });
    return { ok: true, replay: false };
  }
}
