import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateProductAdminDto } from './create-product.dto';

/** variants and assetIds are managed via dedicated sub-routes */
export class UpdateProductAdminDto extends PartialType(
  OmitType(CreateProductAdminDto, ['variants', 'assetIds'] as const),
) {}
