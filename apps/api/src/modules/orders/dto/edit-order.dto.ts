import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsNotEmpty,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class AddItemDto {
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

class RemoveItemDto {
  @IsString()
  @IsNotEmpty()
  orderItemId!: string;
}

class EditAddressDto {
  @IsString()
  fullName!: string;

  @IsString()
  phone!: string;

  @IsString()
  addressLine1!: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country!: string;
}

export class EditOrderDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddItemDto)
  addItems?: AddItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemoveItemDto)
  removeItems?: RemoveItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => EditAddressDto)
  shippingAddress?: EditAddressDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  manualDiscount?: number;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}
