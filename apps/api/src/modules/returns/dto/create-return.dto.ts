import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReturnReason, ReturnRefundMethod } from '@prisma/client';

export class ReturnItemDto {
  @IsString()
  @IsNotEmpty()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  /** Required when refundMethod is EXCHANGE: the variant the customer wants in exchange. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  exchangeVariantId?: string;
}

export class CreateReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  @IsEnum(ReturnReason)
  reason!: ReturnReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reasonDetail?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoAssetIds?: string[];

  @IsOptional()
  @IsEnum(ReturnRefundMethod)
  refundMethod?: ReturnRefundMethod;
}
