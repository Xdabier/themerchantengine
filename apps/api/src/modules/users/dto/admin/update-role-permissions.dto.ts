import { IsArray, ArrayNotEmpty, ArrayUnique, IsIn, IsString } from 'class-validator';
import { PERMISSION_STRINGS } from '@common/decorators';

export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayNotEmpty()
  // A repeated key used to reach the transaction and 409 on @@unique([roleId, permission]).
  @ArrayUnique()
  @IsString({ each: true })
  // Membership, not format. A well-formed but unknown key (`tax:view`) used to
  // save cleanly and gate nothing, which is how ten dead modules reached the
  // roles grid.
  @IsIn(PERMISSION_STRINGS, {
    each: true,
    message: 'Each permission must be a known module:action pair',
  })
  permissions: string[];
}
