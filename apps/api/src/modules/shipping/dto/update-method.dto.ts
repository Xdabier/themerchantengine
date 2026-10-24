import { PartialType } from '@nestjs/mapped-types';
import { CreateShippingMethodAdminDto } from './create-method.dto';

export class UpdateShippingMethodAdminDto extends PartialType(CreateShippingMethodAdminDto) {}
