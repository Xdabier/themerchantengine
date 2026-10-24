import { NotFoundException } from '@nestjs/common';

/**
 * Admin or storefront lookup by order id returned no row (or only a
 * soft-deleted row). Hot path — 8 call sites across the orders service.
 */
export class OrderNotFoundException extends NotFoundException {
  static readonly CODE = 'ORDER_NOT_FOUND' as const;

  constructor(orderId?: string) {
    super({
      error: {
        code: OrderNotFoundException.CODE,
        message: orderId ? `Order "${orderId}" not found` : 'Order not found',
      },
    });
  }
}
