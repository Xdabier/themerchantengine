import { ConflictException } from '@nestjs/common';

/**
 * A set-to write lost its compare-and-set: the row no longer holds the
 * `onHand` the operator saw when they typed the target.
 *
 * A 409 rather than a silent overwrite, because the alternative is a lost
 * update on the number the whole catalogue depends on. `details.currentOnHand`
 * lets the screen re-seed the field so the operator can retype against what is
 * actually there.
 */
export class InventoryStockConflictException extends ConflictException {
  static readonly CODE = 'INVENTORY_STOCK_CONFLICT' as const;

  constructor(currentOnHand: number) {
    super({
      error: {
        code: InventoryStockConflictException.CODE,
        message: 'Stock changed since this screen was opened',
        details: { currentOnHand },
      },
    });
  }
}
