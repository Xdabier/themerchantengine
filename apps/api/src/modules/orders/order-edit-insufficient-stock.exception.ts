import { ConflictException } from '@nestjs/common';

/**
 * Admin order-edit add-item path failed because the variant has insufficient
 * stock or the stock-reserve race-loser branch tripped. Distinct from B1's
 * storefront-tier `ORDER_INSUFFICIENT_STOCK` (checkout creation) and from the
 * cart-tier `CART_INSUFFICIENT_STOCK`.
 */
export class OrderEditInsufficientStockException extends ConflictException {
  static readonly CODE = 'ORDER_EDIT_INSUFFICIENT_STOCK' as const;

  constructor(variantId: string, message?: string) {
    super({
      error: {
        code: OrderEditInsufficientStockException.CODE,
        message: message ?? `Insufficient stock for variant "${variantId}"`,
      },
    });
  }
}
