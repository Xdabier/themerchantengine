import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TranslatableDto } from './translatable.dto';

/**
 * Admin DTO — issue a gift card or system store credit.
 *
 * Store credit: omit purchasedBy (null) and set recipientEmail to the
 * customer's email. Issued on return refund, admin grant, or loyalty reward.
 */
export class CreateGiftCardAdminDto {
  /** Initial (and maximum) balance. Immutable after creation. */
  @IsNumber()
  @IsPositive()
  initialBalance: number;

  /** ISO 4217 currency code, e.g. "EUR". */
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency: string;

  /** Optional — override auto-generated code. Must be 8–20 uppercase alphanumeric chars. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{8,20}$/)
  code?: string;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipientName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  personalMessage?: TranslatableDto;

  /**
   * Customer UUID who purchased this card.
   * Omit (or set null) for system-issued store credit.
   */
  @IsOptional()
  @IsString()
  purchasedBy?: string;

  /** ISO 8601 datetime. Null = never expires. */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
