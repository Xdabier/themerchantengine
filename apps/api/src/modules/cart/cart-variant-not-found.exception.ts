import { NotFoundException } from '@nestjs/common';

/**
 * Storefront tried to add a `ProductVariant` to the cart that is missing,
 * soft-deleted, inactive, or whose product has been soft-deleted (see
 * `cart.service.ts:addItem` line 262 guard). This exception carries a stable
 * error code so the storefront can map it to a localized "variant not
 * available" message — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #3.
 */
export class CartVariantNotFoundException extends NotFoundException {
  static readonly CODE = 'CART_VARIANT_NOT_FOUND' as const;

  constructor() {
    super({
      error: {
        code: CartVariantNotFoundException.CODE,
        message: 'Product variant not found or unavailable',
      },
    });
  }
}
