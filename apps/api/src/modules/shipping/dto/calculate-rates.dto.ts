import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ShippingRateItemDto {
  @IsNumber()
  @Min(0)
  weight: number;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CalculateRatesDto {
  @IsString()
  @Length(2, 2)
  country: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingRateItemDto)
  items: ShippingRateItemDto[];

  @IsNumber()
  @Min(0)
  subtotal: number;
}
