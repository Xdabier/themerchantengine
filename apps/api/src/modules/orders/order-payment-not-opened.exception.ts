import { ConflictException } from '@nestjs/common';

/** The order has no provider session, so there is nothing to capture, refund or cancel. */
export class OrderPaymentNotOpenedException extends ConflictException {
  static readonly CODE = 'ORDER_PAYMENT_NOT_OPENED' as const;

  constructor(orderId: string) {
    super({
      error: {
        code: OrderPaymentNotOpenedException.CODE,
        message: `Order ${orderId} has no open payment session`,
      },
    });
  }
}
