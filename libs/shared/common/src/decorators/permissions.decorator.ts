import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to specify required permissions for a route.
 * Usage: @Permissions('module:action')
 *
 * The decorator currently accepts any string for backwards compatibility with
 * call sites authored before the typed Permission union. Prefer passing values
 * that satisfy the exported `Permission` template-string type; mistypes show up
 * at runtime as a 403 with code `AUTH_PERMISSION_INSUFFICIENT`, and
 * `apps/api/src/permission-key-drift.spec.ts` fails on any key outside the
 * catalogue.
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * The permission catalogue lives in `libs/shared/permissions` (`@permissions`)
 * so the api, the seed, and the admin roles grid all read one list. It is
 * re-exported here because every existing call site imports it from
 * `@common/decorators`; the Nest-specific half above stays local.
 */
export {
  PERMISSION_MODULES,
  PERMISSION_ACTIONS,
  PERMISSION_STRINGS,
  isPermission,
} from '@permissions';
export type { Permission, PermissionModule, PermissionAction } from '@permissions';
