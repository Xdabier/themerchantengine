import { PartialType } from '@nestjs/mapped-types';
import { CreateProductVariantAdminDto } from './create-variant.dto';

export class UpdateProductVariantAdminDto extends PartialType(CreateProductVariantAdminDto) {}
