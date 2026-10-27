import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class TransferInventoryAdminDto {
  @IsString()
  @IsNotEmpty()
  variantId: string;

  @IsString()
  @IsNotEmpty()
  fromLocationId: string;

  @IsString()
  @IsNotEmpty()
  toLocationId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
