import { NotFoundException } from '@nestjs/common';

/**
 * Product FAQ lookup by id returned no row.
 */
export class ProductFaqNotFoundException extends NotFoundException {
  static readonly CODE = 'PRODUCT_FAQ_NOT_FOUND' as const;

  constructor(message = 'FAQ not found') {
    super({ error: { code: ProductFaqNotFoundException.CODE, message } });
  }
}
