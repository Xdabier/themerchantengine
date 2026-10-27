import { ConflictException } from '@nestjs/common';

/**
 * Variant create or update attempted to claim a `sku` already owned by another
 * variant (cross-product uniqueness).
 */
export class ProductSkuTakenException extends ConflictException {
  static readonly CODE = 'PRODUCT_SKU_TAKEN' as const;

  constructor(sku: string) {
    super({
      error: {
        code: ProductSkuTakenException.CODE,
        message: `SKU "${sku}" is already in use`,
      },
    });
  }
}
