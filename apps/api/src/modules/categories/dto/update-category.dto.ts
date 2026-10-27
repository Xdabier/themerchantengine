import { PartialType } from '@nestjs/mapped-types';
import { CreateCategoryAdminDto } from './create-category.dto';

export class UpdateCategoryAdminDto extends PartialType(CreateCategoryAdminDto) {}
