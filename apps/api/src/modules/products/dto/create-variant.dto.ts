import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { MONEY_DECIMAL_PLACES } from '@common/money';

export class CreateProductVariantAdminDto {
  @IsString()
  sku: string;

  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Type(() => Number)
  price: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Type(() => Number)
  compareAtPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Type(() => Number)
  costPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  weight?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  length?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  width?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  height?: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Digital product — max downloads per order */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDownloads?: number;

  /** Digital product — days until download link expires */
  @IsOptional()
  @IsInt()
  @Min(1)
  downloadExpiryDays?: number;

  /** Digital product — software license key */
  @IsOptional()
  @IsString()
  licenseKey?: string;

  /** AttributeValue IDs to assign to this variant */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attributeValueIds?: string[];
}
