import { PartialType } from '@nestjs/mapped-types';
import { CreateProductTypeAdminDto } from './create-product-type.dto';

export class UpdateProductTypeAdminDto extends PartialType(CreateProductTypeAdminDto) {}
