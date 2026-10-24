import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Roles the staff list can be filtered by. Wider than `StaffRole` on purpose:
 * the screen answers "who holds back-office access", so it must show super
 * admins. The create / update DTOs keep the narrower `StaffRole` enum, so
 * nobody can mint or promote to SUPER_ADMIN through this surface.
 */
export enum ListStaffRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  SUPPORT = 'SUPPORT',
}

export const LISTABLE_STAFF_ROLES = Object.values(ListStaffRole);

export class ListStaffQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsEnum(ListStaffRole)
  role?: ListStaffRole;
}
