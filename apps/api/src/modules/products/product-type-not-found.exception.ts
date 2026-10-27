import { NotFoundException } from '@nestjs/common';

/**
 * Product-type lookup by id returned no row.
 */
export class ProductTypeNotFoundException extends NotFoundException {
  static readonly CODE = 'PRODUCT_TYPE_NOT_FOUND' as const;

  constructor(message = 'Product type not found') {
    super({ error: { code: ProductTypeNotFoundException.CODE, message } });
  }
}
