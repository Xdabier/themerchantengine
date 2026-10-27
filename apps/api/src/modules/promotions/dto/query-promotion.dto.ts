import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PromotionApplicationMethod, PromotionType } from '@prisma/client';

export class ListPromotionsAdminDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsEnum(PromotionType)
  type?: PromotionType;

  @IsOptional()
  @IsEnum(PromotionApplicationMethod)
  applicationMethod?: PromotionApplicationMethod;

  /** Filter by active state. Query string: ?isActive=true */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  isActive?: boolean;
}
