import { BadGatewayException } from '@nestjs/common';

/** The provider refused the request or answered with something unexpected. */
export class PaymentProviderRejectedException extends BadGatewayException {
  static readonly CODE = 'PAYMENT_PROVIDER_REJECTED' as const;

  constructor(providerId: string, reason: string) {
    super({
      error: {
        code: PaymentProviderRejectedException.CODE,
        message: 'The payment provider rejected the request',
        details: { providerId, reason },
      },
    });
  }
}
