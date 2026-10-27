import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
} from 'class-validator';
import { PERMISSION_STRINGS } from '@common/decorators';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsArray()
  @ArrayNotEmpty()
  // A repeated key used to reach the transaction and 409 on @@unique([roleId, permission]).
  @ArrayUnique()
  @IsString({ each: true })
  // Membership, not format. See UpdateRolePermissionsDto.
  @IsIn(PERMISSION_STRINGS, {
    each: true,
    message: 'Each permission must be a known module:action pair',
  })
  permissions: string[];
}
