import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreatePageAdminDto } from './create-page.dto';

/**
 * All fields optional; slug cannot be changed after creation.
 */
export class UpdatePageAdminDto extends PartialType(
  OmitType(CreatePageAdminDto, ['slug'] as const),
) {}
