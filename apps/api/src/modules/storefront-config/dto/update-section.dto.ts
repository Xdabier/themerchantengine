import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateSectionAdminDto } from './create-section.dto';

/**
 * All fields optional; pageSlug cannot be changed after creation.
 */
export class UpdateSectionAdminDto extends PartialType(
  OmitType(CreateSectionAdminDto, ['pageSlug'] as const),
) {}
