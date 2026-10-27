import { BadRequestException } from '@nestjs/common';

/**
 * A product create or update named a `categoryIds` entry that does not exist.
 *
 * A 400 rather than a 404: the product is the addressed resource and it is
 * fine, the request body is what is wrong. Without this the unknown id reached
 * `productCategory.createMany` and surfaced as a Prisma P2003 foreign-key
 * error, i.e. a 500 for what is a client mistake.
 */
export class ProductCategoryNotFoundException extends BadRequestException {
  static readonly CODE = 'PRODUCT_CATEGORY_NOT_FOUND' as const;

  constructor(missingIds: readonly string[]) {
    super({
      error: {
        code: ProductCategoryNotFoundException.CODE,
        message:
          missingIds.length === 1
            ? `Category "${missingIds[0]}" does not exist`
            : `${missingIds.length} categories do not exist`,
        details: { missingIds: [...missingIds] },
      },
    });
  }
}
