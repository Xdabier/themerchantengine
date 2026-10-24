import { BadRequestException } from '@nestjs/common';

/** A webhook reached a provider that does not take webhooks. */
export class PaymentWebhookUnsupportedException extends BadRequestException {
  static readonly CODE = 'PAYMENT_WEBHOOK_UNSUPPORTED' as const;

  constructor(providerId: string) {
    super({
      error: {
        code: PaymentWebhookUnsupportedException.CODE,
        message: 'This payment provider does not accept webhooks',
        details: { providerId },
      },
    });
  }
}
