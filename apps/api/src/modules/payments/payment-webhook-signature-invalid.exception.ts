import { BadRequestException } from '@nestjs/common';

/** A webhook signature is missing or does not verify. */
export class PaymentWebhookSignatureInvalidException extends BadRequestException {
  static readonly CODE = 'PAYMENT_WEBHOOK_SIGNATURE_INVALID' as const;

  constructor(providerId: string) {
    super({
      error: {
        code: PaymentWebhookSignatureInvalidException.CODE,
        message: 'The webhook signature is invalid',
        details: { providerId },
      },
    });
  }
}
