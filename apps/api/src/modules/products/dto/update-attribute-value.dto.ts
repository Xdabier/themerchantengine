import { PartialType } from '@nestjs/mapped-types';
import { CreateAttributeValueAdminDto } from './create-attribute-value.dto';

export class UpdateAttributeValueAdminDto extends PartialType(CreateAttributeValueAdminDto) {}
