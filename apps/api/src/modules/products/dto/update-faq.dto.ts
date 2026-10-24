import { PartialType } from '@nestjs/mapped-types';
import { CreateProductFaqAdminDto } from './create-faq.dto';

export class UpdateProductFaqAdminDto extends PartialType(CreateProductFaqAdminDto) {}
