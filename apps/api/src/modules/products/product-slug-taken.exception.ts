import { ConflictException } from '@nestjs/common';

/**
 * Create or update attempted to claim a `slug` already owned by another product.
 */
export class ProductSlugTakenException extends ConflictException {
  static readonly CODE = 'PRODUCT_SLUG_TAKEN' as const;

  constructor(slug: string) {
    super({
      error: {
        code: ProductSlugTakenException.CODE,
        message: `Slug "${slug}" is already taken`,
      },
    });
  }
}
