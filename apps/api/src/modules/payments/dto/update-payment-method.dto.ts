import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, Min, ValidateNested } from 'class-validator';
import { OptionalTranslatableDto } from './translatable.dto';

/**
 * Admin PATCH — every field optional, PATCH semantics. `config` merges
 * with the stored blob so updates can touch one key without having to
 * round-trip the full (secret-masked) object.
 */
export class UpdatePaymentMethodDto {
  @ValidateNested()
  @Type(() => OptionalTranslatableDto)
  @IsOptional()
  name?: OptionalTranslatableDto;

  @ValidateNested()
  @Type(() => OptionalTranslatableDto)
  @IsOptional()
  description?: OptionalTranslatableDto;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isTestMode?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;
}
