import { BadRequestException } from '@nestjs/common';

/**
 * Storefront attempted to create an order against an empty cart. The cart
 * fetch at `orders.service.ts:createOrder` (line 116) returned zero items,
 * which the order pipeline cannot price or fulfil. Carries a stable error
 * code so the checkout page can surface a localized "cart empty" message
 * instead of the generic mutation copy — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #7.
 */
export class OrderCartEmptyException extends BadRequestException {
  static readonly CODE = 'ORDER_CART_EMPTY' as const;

  constructor() {
    super({
      error: {
        code: OrderCartEmptyException.CODE,
        message: 'Cart is empty',
      },
    });
  }
}
