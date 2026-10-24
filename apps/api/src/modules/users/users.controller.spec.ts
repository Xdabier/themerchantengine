import 'reflect-metadata';
import { PERMISSIONS_KEY, OWNER_GUARD_KEY, IS_PUBLIC_KEY } from '@common/decorators';
import { UsersController } from './users.controller';

/**
 * Structural security test: verifies that every admin route has @Permissions()
 * and every customer route has @OwnerGuard(). Prevents accidental exposure
 * of unguarded endpoints (OWASP API5 — BFLA).
 */
describe('UsersController — decorator audit', () => {
  // ── Admin routes MUST have @Permissions() ─────────────────────────────

  const adminMethods: [string, string][] = [
    ['listCustomers', 'customers:view'],
    ['getCustomer', 'customers:view'],
    ['listStaff', 'admin_users:view'],
    ['createStaff', 'admin_users:create'],
    ['updateStaff', 'admin_users:update'],
    ['deactivateStaff', 'admin_users:delete'],
    ['listRoles', 'admin_users:view'],
    ['createRole', 'admin_users:manage'],
    ['updateRolePermissions', 'admin_users:manage'],
  ];

  it.each(adminMethods)('%s must have @Permissions(%s)', (method, expectedPermission) => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      UsersController.prototype[method as keyof UsersController],
    ) as string[] | undefined;

    expect(permissions).toBeDefined();
    expect(permissions).toContain(expectedPermission);
  });

  // ── Customer routes MUST have @OwnerGuard() ────────────────────────────

  const customerMethods = [
    'getProfile',
    'updateProfile',
    'createAddress',
    'updateAddress',
    'deleteAddress',
    'setDefaultAddress',
  ];

  it.each(customerMethods)('%s must have @OwnerGuard()', (method) => {
    const ownerGuard = Reflect.getMetadata(
      OWNER_GUARD_KEY,
      UsersController.prototype[method as keyof UsersController],
    ) as boolean | undefined;

    expect(ownerGuard).toBe(true);
  });

  // ── Admin routes must NOT have @Public() ───────────────────────────────

  it.each(adminMethods.map(([m]) => m))('%s must NOT have @Public()', (method) => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      UsersController.prototype[method as keyof UsersController],
    ) as boolean | undefined;

    expect(isPublic).toBeFalsy();
  });
});
