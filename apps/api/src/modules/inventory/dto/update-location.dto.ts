import { PartialType } from '@nestjs/mapped-types';
import { CreateInventoryLocationAdminDto } from './create-location.dto';

export class UpdateInventoryLocationAdminDto extends PartialType(CreateInventoryLocationAdminDto) {}
