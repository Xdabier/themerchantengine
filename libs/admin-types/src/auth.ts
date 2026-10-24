import * as z from 'zod';
import { entityIdSchema } from './ids';

/**
 * Shape of the authenticated admin user as returned by GET /v1/admin/me.
 * Covers the minimum the frontend needs for auth + permission gating.
 */

export const adminUserRoleSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  permissions: z.array(z.string()),
});
export type AdminUserRole = z.infer<typeof adminUserRoleSchema>;

/**
 * Coarse account role, as the Better Auth `customSession` plugin puts it on
 * every session payload (`apps/api/src/auth/auth.ts`). Distinct from `roles`
 * below, which is the fine-grained RBAC assignment.
 *
 * `adminUserSchema` used to omit the key entirely, and Zod strips unknown
 * keys, so a CUSTOMER session parsed into a valid `AdminUser` with empty roles
 * and permissions and the admin shell mounted for them (finding AD6).
 */
export const accountRoleSchema = z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT', 'CUSTOMER']);
export type AccountRole = z.infer<typeof accountRoleSchema>;

export const adminUserSchema = z.object({
  /**
   * Optional here on purpose. Four other consumers build on this schema
   * (`customerSchema`, `staffMemberSchema`, `createStaff` / `updateStaff`,
   * admin `/v1/users/me`) and not all of their endpoints send a role; a
   * required key would turn a missing field into a parse throw and a
   * "Could not load" screen. The session payload is the one place the role is
   * guaranteed, so `adminSessionUserSchema` below is where it is mandatory.
   */
  role: accountRoleSchema.optional(),
  id: entityIdSchema,
  email: z.string().email(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  roles: z.array(adminUserRoleSchema).default([]),
  permissions: z.array(z.string()).default([]),
  status: z.enum(['active', 'inactive', 'locked']).default('active'),
  lastLoginAt: z.string().datetime().nullable().optional(),
  /** Whether the operator has enrolled TOTP 2FA — drives the security screen. */
  twoFactorEnabled: z.boolean().nullable().optional(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

/**
 * The session payload of `GET /api/auth/get-session`, where Better Auth's
 * `customSession` plugin always attaches the account role
 * (`apps/api/src/auth/auth.ts`).
 *
 * `role` is REQUIRED here, and that is the whole fail-closed property: a
 * payload whose role cannot be read is a session we cannot classify, so it
 * fails to parse and `getSession()` degrades it to signed-out.
 */
export const adminSessionUserSchema = adminUserSchema.extend({
  role: accountRoleSchema,
});
export type AdminSessionUser = z.infer<typeof adminSessionUserSchema>;

/**
 * Whether this account may be shown the admin dashboard at all.
 *
 * A gate at session-commit time, not a permission check: a staff member with
 * no permissions still gets the shell and sees empty screens, while a customer
 * gets bounced to the admin login. The cookie is shared across subdomains in
 * production by design, so a customer reaching the admin host is expected, not
 * an attack.
 */
export function isStaff(user: AdminSessionUser): boolean {
  return user.role !== 'CUSTOMER';
}

/** Helper: compute the effective permission set from a user's roles + direct permissions. */
export function effectivePermissions(user: AdminUser): Set<string> {
  const set = new Set(user.permissions ?? []);
  for (const role of user.roles ?? []) {
    for (const perm of role.permissions) set.add(perm);
  }
  return set;
}

/**
 * Admin locale set is fetched from backend, but we ship a default for bootstrap.
 * Kept in step with `BOOTSTRAP_LOCALE` in the admin app and with the
 * `localization.defaultLocale` store setting.
 */
export const defaultLocale = 'fr';
