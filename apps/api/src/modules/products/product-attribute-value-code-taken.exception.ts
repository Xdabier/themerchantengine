import { ConflictException } from '@nestjs/common';

/**
 * Attribute-value create/update attempted to claim a `code` already owned by
 * another value on the same parent attribute.
 */
export class ProductAttributeValueCodeTakenException extends ConflictException {
  static readonly CODE = 'PRODUCT_ATTRIBUTE_VALUE_CODE_TAKEN' as const;

  constructor(code: string) {
    super({
      error: {
        code: ProductAttributeValueCodeTakenException.CODE,
        message: `Value code "${code}" already exists in this attribute`,
      },
    });
  }
}
