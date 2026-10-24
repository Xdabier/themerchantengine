import { NotFoundException } from '@nestjs/common';

/**
 * Product-attribute lookup by id returned no row.
 */
export class ProductAttributeNotFoundException extends NotFoundException {
  static readonly CODE = 'PRODUCT_ATTRIBUTE_NOT_FOUND' as const;

  constructor(message = 'Attribute not found') {
    super({ error: { code: ProductAttributeNotFoundException.CODE, message } });
  }
}
