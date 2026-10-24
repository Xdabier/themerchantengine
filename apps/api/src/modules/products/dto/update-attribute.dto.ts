import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateAttributeAdminDto } from './create-attribute.dto';

/** productTypeId is immutable after creation */
export class UpdateAttributeAdminDto extends PartialType(
  OmitType(CreateAttributeAdminDto, ['productTypeId'] as const),
) {}
