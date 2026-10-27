import { BadRequestException } from '@nestjs/common';

/**
 * A specification label folded to an empty key.
 *
 * `key` keeps only letters and digits, so a label made entirely of punctuation
 * or symbols ("---", "!!!") folds to "". Such a row could never be filtered on
 * the storefront, and a second one on the same product would collide with it on
 * `@@unique([productId, key])` for a reason the operator could not see.
 */
export class ProductSpecEmptyKeyException extends BadRequestException {
  static readonly CODE = 'PRODUCT_SPEC_EMPTY_KEY' as const;

  constructor(message = 'A specification label needs at least one letter or digit') {
    super({ error: { code: ProductSpecEmptyKeyException.CODE, message } });
  }
}
