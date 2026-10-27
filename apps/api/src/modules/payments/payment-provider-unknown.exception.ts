import { BadRequestException } from '@nestjs/common';

/** A payment method names a provider id that no registered provider owns. */
export class PaymentProviderUnknownException extends BadRequestException {
  static readonly CODE = 'PAYMENT_PROVIDER_UNKNOWN' as const;

  constructor(providerId: string) {
    super({
      error: {
        code: PaymentProviderUnknownException.CODE,
        message: 'Payment provider is not available',
        details: { providerId },
      },
    });
  }
}
