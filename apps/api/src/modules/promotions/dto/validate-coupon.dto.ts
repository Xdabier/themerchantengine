import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CartItemDto {
  @IsString()
  productId: string;

  @IsString()
  categoryId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class ValidateCouponDto {
  @IsString()
  code: string;

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  /** Optional: supply to enforce per-user usage limits. */
  @IsOptional()
  @IsString()
  userId?: string;
}

export class GetAutomaticPromotionsDto {
  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsOptional()
  @IsString()
  userId?: string;
}
