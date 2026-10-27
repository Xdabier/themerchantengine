import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { StaffRole } from './create-staff.dto';

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  @IsOptional()
  @IsString()
  roleId?: string;
}
