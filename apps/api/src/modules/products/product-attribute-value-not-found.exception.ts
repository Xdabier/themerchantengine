import { NotFoundException } from '@nestjs/common';

/**
 * Product-attribute-value lookup by id returned no row.
 */
export class ProductAttributeValueNotFoundException extends NotFoundException {
  static readonly CODE = 'PRODUCT_ATTRIBUTE_VALUE_NOT_FOUND' as const;

  constructor(message = 'Attribute value not found') {
    super({ error: { code: ProductAttributeValueNotFoundException.CODE, message } });
  }
}
