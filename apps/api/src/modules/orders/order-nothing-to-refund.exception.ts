import { ConflictException } from '@nestjs/common';

/** Processed returns already gave back the whole order total. */
export class OrderNothingToRefundException extends ConflictException {
  static readonly CODE = 'ORDER_NOTHING_TO_REFUND' as const;

  constructor(orderId: string) {
    super({
      error: {
        code: OrderNothingToRefundException.CODE,
        message: `Order ${orderId} has nothing left to refund`,
      },
    });
  }
}
