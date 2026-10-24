import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { MERCHANDISING_RULE_TYPES } from '../search.constants';

export class CreateMerchandisingRuleDto {
  @IsEnum(MERCHANDISING_RULE_TYPES)
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
