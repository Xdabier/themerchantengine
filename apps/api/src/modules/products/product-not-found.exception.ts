import { NotFoundException } from '@nestjs/common';

/**
 * Lookup by id/slug returned no row (or only a soft-deleted row). Used across
 * the products service for the canonical product-by-id, product-by-slug, and
 * admin-edit lookup paths.
 */
export class ProductNotFoundException extends NotFoundException {
  static readonly CODE = 'PRODUCT_NOT_FOUND' as const;

  constructor(message = 'Product not found') {
    super({ error: { code: ProductNotFoundException.CODE, message } });
  }
}
