import { PartialType } from '@nestjs/mapped-types';
import { CreateShippingZoneAdminDto } from './create-zone.dto';

export class UpdateShippingZoneAdminDto extends PartialType(CreateShippingZoneAdminDto) {}
