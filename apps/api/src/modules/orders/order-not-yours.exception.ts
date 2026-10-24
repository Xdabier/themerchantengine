import { ForbiddenException } from '@nestjs/common';

/**
 * Storefront customer attempted to access an order owned by another
 * customer. 3 call sites in `orders.service.ts` for read / cancel /
 * track endpoints.
 */
export class OrderNotYoursException extends ForbiddenException {
  static readonly CODE = 'ORDER_NOT_YOURS' as const;

  constructor() {
    super({
      error: { code: OrderNotYoursException.CODE, message: 'Not your order' },
    });
  }
}
