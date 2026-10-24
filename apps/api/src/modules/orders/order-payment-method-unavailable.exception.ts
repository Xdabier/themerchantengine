import { BadRequestException } from '@nestjs/common';

/**
 * The operator has no enabled payment method at all, so the store cannot take
 * an order (pass-2 finding D2).
 *
 * Until this existed, zero configured methods meant checkout printed a
 * hardcoded cash-on-delivery note and placed the order anyway, recording a
 * tender nobody had configured and nobody had chosen. Refusing is the
 * deliberate alternative: a store that offers no way to pay is misconfigured,
 * and saying so is better than inventing one.
 */
export class OrderPaymentMethodUnavailableException extends BadRequestException {
  static readonly CODE = 'ORDER_PAYMENT_METHOD_UNAVAILABLE' as const;

  constructor() {
    super({
      error: {
        code: OrderPaymentMethodUnavailableException.CODE,
        message: 'No payment method is available',
      },
    });
  }
}
