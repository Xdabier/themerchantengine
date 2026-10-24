import { ConflictException } from '@nestjs/common';

/**
 * Product-type create/update attempted to claim a `code` already owned by
 * another product-type.
 */
export class ProductTypeCodeTakenException extends ConflictException {
  static readonly CODE = 'PRODUCT_TYPE_CODE_TAKEN' as const;

  constructor(code: string) {
    super({
      error: {
        code: ProductTypeCodeTakenException.CODE,
        message: `Product type code "${code}" already exists`,
      },
    });
  }
}
