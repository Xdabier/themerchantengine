import { NotFoundException } from '@nestjs/common';

/**
 * Admin or storefront category lookup by id/slug returned no row. 4 call
 * sites in `categories.service.ts`.
 */
export class CategoryNotFoundException extends NotFoundException {
  static readonly CODE = 'CATEGORY_NOT_FOUND' as const;

  constructor(message = 'Category not found') {
    super({ error: { code: CategoryNotFoundException.CODE, message } });
  }
}
