import { NotFoundException } from '@nestjs/common';

/**
 * Variant lookup by id returned no row on an admin-side path. Distinct from
 * the storefront-tier `CART_VARIANT_NOT_FOUND` (B1) which fires on the
 * customer add-to-cart path with anti-enumeration semantics.
 */
export class ProductVariantNotFoundException extends NotFoundException {
  static readonly CODE = 'PRODUCT_VARIANT_NOT_FOUND' as const;

  constructor(message = 'Variant not found') {
    super({ error: { code: ProductVariantNotFoundException.CODE, message } });
  }
}
