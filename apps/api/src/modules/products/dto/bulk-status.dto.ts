import { ArrayNotEmpty, IsArray, IsEnum, IsString } from 'class-validator';
import { ProductStatus } from '@prisma/client';

export class BulkUpdateStatusAdminDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  productIds: string[];

  @IsEnum(ProductStatus)
  status: ProductStatus;
}
