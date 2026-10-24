import { NotFoundException } from '@nestjs/common';

/**
 * Parent-category lookup in a create or move-parent operation returned no
 * row. 3 call sites.
 */
export class CategoryParentNotFoundException extends NotFoundException {
  static readonly CODE = 'CATEGORY_PARENT_NOT_FOUND' as const;

  constructor(message = 'Parent category not found') {
    super({ error: { code: CategoryParentNotFoundException.CODE, message } });
  }
}
