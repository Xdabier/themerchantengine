import { IsNumber, IsOptional, IsString, MaxLength, MinLength, NotEquals } from 'class-validator';

import { MONEY_DECIMAL_PLACES } from '@common/money';

/**
 * Admin DTO — adjust a gift card's balance.
 *
 * `amount` is a signed delta: positive = credit, negative = debit. It
 * MUST be non-zero. `reason` is stored in the ledger `note` column so
 * audit tooling can explain why a manual correction happened.
 */
export class AdjustGiftCardBalanceDto {
  /** Signed delta to apply to `currentBalance`. Non-zero. */
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @NotEquals(0)
  amount!: number;

  /** Operator-supplied reason; persisted in the ledger. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  /** Optional reference id (order, return) for cross-linking. */
  @IsString()
  @IsOptional()
  @MaxLength(128)
  referenceId?: string;
}
