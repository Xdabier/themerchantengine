import { ArrayNotEmpty, IsArray, IsNumber, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { MONEY_DECIMAL_PLACES } from '@common/money';

export class BulkPriceItemDto {
  /** Variant ID */
  @IsString()
  variantId: string;

  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Type(() => Number)
  price: number;
}

export class BulkUpdatePricesAdminDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BulkPriceItemDto)
  items: BulkPriceItemDto[];
}
