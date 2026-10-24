import { ServiceUnavailableException } from '@nestjs/common';

/** The provider is not configured, or its API cannot be reached right now. */
export class PaymentProviderUnavailableException extends ServiceUnavailableException {
  static readonly CODE = 'PAYMENT_PROVIDER_UNAVAILABLE' as const;

  constructor(providerId: string) {
    super({
      error: {
        code: PaymentProviderUnavailableException.CODE,
        message: 'The payment provider is unavailable, try again later',
        details: { providerId },
      },
    });
  }
}
