import { PartialType } from '@nestjs/mapped-types';
import { CreateTaxZoneAdminDto } from './create-zone.dto';

export class UpdateTaxZoneAdminDto extends PartialType(CreateTaxZoneAdminDto) {}
