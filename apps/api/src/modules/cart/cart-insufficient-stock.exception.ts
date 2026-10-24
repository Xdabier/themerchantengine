import { BadRequestException } from '@nestjs/common';

/**
 * Storefront tried to add or update a `CartItem` whose requested quantity
 * exceeds the variant's live stock. Raised by both `cart.service.ts:addItem`
 * (line 268 guard) and `cart.service.ts:updateItem` (line 341 guard). This
 * exception carries a stable error code so the storefront can map it to a
 * localized "insufficient stock" message rather than collapsing to the
 * generic cart-mutation error — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 rows #4-5.
 */
export class CartInsufficientStockException extends BadRequestException {
  static readonly CODE = 'CART_INSUFFICIENT_STOCK' as const;

  constructor() {
    super({
      error: {
        code: CartInsufficientStockException.CODE,
        message: 'Insufficient stock for the requested quantity',
      },
    });
  }
}
