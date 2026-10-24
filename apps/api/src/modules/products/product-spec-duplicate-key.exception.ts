import { BadRequestException } from '@nestjs/common';

/**
 * Two rows in one specifications payload fold to the same key.
 *
 * `key` is the accent-folded form of `label.default`, so "Matériau" and
 * "Materiau" in the same matrix are one specification as far as
 * `@@unique([productId, key])` is concerned. Caught before the transaction
 * because reaching the database would surface as a Prisma P2002, i.e. a 500 for
 * what is a client mistake.
 *
 * Deliberately not a silent merge: the two rows carry different values, and
 * picking one for the operator would drop the other without saying so.
 */
export class ProductSpecDuplicateKeyException extends BadRequestException {
  static readonly CODE = 'PRODUCT_SPEC_DUPLICATE_KEY' as const;

  constructor(key: string, labels: readonly string[]) {
    super({
      error: {
        code: ProductSpecDuplicateKeyException.CODE,
        message: `Specifications ${labels.map((l) => `"${l}"`).join(' and ')} are the same specification`,
        details: { key, labels: [...labels] },
      },
    });
  }
}
