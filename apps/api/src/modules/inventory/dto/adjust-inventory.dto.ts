import { AdjustmentReason } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AdjustInventoryAdminDto {
  @IsString()
  @IsNotEmpty()
  variantId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  /**
   * DELTA mode. Positive adds stock, negative removes it. The service applies
   * it with a guarded UPDATE, so a negative delta that would drive `onHand`
   * below zero is refused by the database rather than by a read-then-compare.
   *
   * Optional only because SET mode is the alternative. Exactly one of
   * `quantity` and `setTo` must be present, and the service enforces that.
   * `@ValidateIf` deliberately is NOT used for the exclusivity: class-validator
   * whitelisting strips only properties with no validation metadata, and the
   * metadata `@ValidateIf` registers counts, so `forbidNonWhitelisted` would
   * never fire on a body carrying both.
   */
  @IsOptional()
  @IsInt()
  quantity?: number;

  /**
   * SET mode. The absolute quantity the operator wants at this location.
   *
   * Exists because an operator counting a shelf thinks in totals, not deltas,
   * and computing the delta client-side is a lost update: two operators both
   * reading 20 and both setting 25 would send +5 and +5 and land at 30.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  setTo?: number;

  /**
   * The `onHand` the operator believed was there when they typed `setTo`.
   *
   * This is the compare half of a compare-and-set: the write only applies while
   * the row still holds this value, so a concurrent change is a refusal rather
   * than a silent overwrite. Required whenever `setTo` is present.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedOnHand?: number;

  @IsEnum(AdjustmentReason)
  reason: AdjustmentReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
