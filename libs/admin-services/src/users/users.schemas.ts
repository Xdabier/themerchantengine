import { z } from 'zod';
import { adminUserSchema, entityIdSchema, paginationMetaSchema } from '@admin-types';
import { PERMISSION_STRINGS } from '@permissions';

/** Backend enum mirrored client-side. */
export const customerSegmentSchema = z.enum([
  'NEW',
  'ACTIVE',
  'LOYAL',
  'AT_RISK',
  'CHURNED',
  'HIGH_VALUE',
  'VIP',
]);
export type CustomerSegment = z.infer<typeof customerSegmentSchema>;

/** Roles a staff account can be created with or promoted to. */
export const staffRoleSchema = z.enum(['ADMIN', 'MANAGER', 'SUPPORT']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/**
 * Roles the staff list can show and filter by. Wider than `staffRoleSchema`:
 * super admins are listed (read-only) so the screen reports back-office access
 * honestly, but they can never be created or promoted through this surface.
 */
export const listStaffRoleSchema = z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT']);
export type ListStaffRole = z.infer<typeof listStaffRoleSchema>;

/**
 * READ side, deliberately permissive: a database that has not run the
 * catalogue reconcile can still hold a legacy key, and a strict read schema
 * would turn that into a "Could not load roles" Zod throw (the Translatable
 * schema-drift bug class). The grid filters unknown keys instead.
 */
const permissionStringSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]*:(view|create|update|delete|manage)$/,
    'Must match "<module>:(view|create|update|delete|manage)"',
  );

/** WRITE side: only permissions the api will accept, so the client fails fast. */
const permissionRequestSchema = z.enum(PERMISSION_STRINGS);

/* Customers */

export const listCustomersQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  search: z.string().max(100).optional(),
  segment: customerSegmentSchema.optional(),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/**
 * The Prisma `Address` shape as `GET /v1/admin/customers/:id` includes it.
 * Deliberately NOT the `/v1/users/me` `addressSchema` below: that one models a
 * different contract (`line1`, `region`, `countryCode`), and reusing it here
 * would be a fresh instance of the schema-drift bug class this plan removes.
 */
export const customerAddressSchema = z.object({
  id: entityIdSchema,
  label: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable().optional(),
  city: z.string(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string(),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
});
export type CustomerAddress = z.infer<typeof customerAddressSchema>;

export const customerSchema = adminUserSchema
  .extend({
    /** Detail endpoint only — the list response omits addresses. */
    addresses: z.array(customerAddressSchema).optional(),
    phone: z.string().max(30).nullable().optional(),
    segment: customerSegmentSchema.optional().nullable(),
    totalSpent: z.number().optional().nullable(),
    orderCount: z.number().int().optional().nullable(),
    /** Detail endpoint only — the list response carries `orderCount` alone. */
    reviewCount: z.number().int().optional().nullable(),
    returnCount: z.number().int().optional().nullable(),
    /** Backend Prisma field — present on customer endpoints, not on admin-user endpoints. */
    isActive: z.boolean().optional(),
  })
  .transform((c) => ({
    ...c,
    // Derive `status` from `isActive` when the backend omits `status`
    // (customers endpoints return `isActive: boolean` from the Prisma model).
    status:
      c.status !== 'active'
        ? c.status
        : c.isActive === false
          ? ('inactive' as const)
          : ('active' as const),
  }));
export type Customer = z.infer<typeof customerSchema>;

export const listCustomersResponseSchema = z.object({
  data: z.array(customerSchema),
  meta: paginationMetaSchema,
});
export type ListCustomersResponse = z.infer<typeof listCustomersResponseSchema>;

export const updateCustomerRequestSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(30).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCustomerRequest = z.infer<typeof updateCustomerRequestSchema>;

export const customerSegmentSummarySchema = z.object({
  segment: customerSegmentSchema,
  count: z.number().int().nonnegative(),
});
export type CustomerSegmentSummary = z.infer<typeof customerSegmentSummarySchema>;

/* Staff */

export const listStaffQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  role: listStaffRoleSchema.optional(),
});
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;

/**
 * A row of `GET /v1/admin/staff`. Distinct from `adminUserSchema`, which models
 * the auth bootstrap (`/v1/users/me`) where `roles[]` with permissions is the
 * real shape. Staff rows carry a base `role` enum plus an optional `customRole`
 * and `isActive` instead; parsing them as an admin user dropped both on strip
 * and defaulted `status` to `active`, so the ROLES column dashed for everyone
 * and deactivated staff still rendered as Active.
 */
export const staffMemberSchema = adminUserSchema
  .extend({
    role: listStaffRoleSchema.optional(),
    customRole: z
      .object({
        id: entityIdSchema,
        name: z.string(),
        // Create / update responses include the permission join rows; the list
        // response does not.
        permissions: z.array(z.unknown()).optional(),
      })
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .transform((s) => ({
    ...s,
    status:
      s.status !== 'active'
        ? s.status
        : s.isActive === false
          ? ('inactive' as const)
          : ('active' as const),
  }));
export type StaffMember = z.infer<typeof staffMemberSchema>;

const passwordPolicy = z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/);

export const createStaffRequestSchema = z.object({
  email: z.string().email(),
  password: passwordPolicy,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: staffRoleSchema,
  roleId: entityIdSchema.optional(),
});
export type CreateStaffRequest = z.infer<typeof createStaffRequestSchema>;

export const updateStaffRequestSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  role: staffRoleSchema.optional(),
  roleId: entityIdSchema.optional(),
});
export type UpdateStaffRequest = z.infer<typeof updateStaffRequestSchema>;

/* Roles */

/**
 * Backend returns `permissions` as join-table rows `[{ permission: 'x' }]`
 * rather than flat strings. Accept both shapes so migrations on either side
 * don't force a lockstep deploy; callers can `.map(p => typeof p === 'string' ? p : p.permission)`.
 */
const rolePermissionEntrySchema = z.union([
  permissionStringSchema,
  z.object({ permission: permissionStringSchema }),
]);

export const roleSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  description: z.string().nullable().optional(),
  permissions: z.array(rolePermissionEntrySchema),
  createdAt: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
});
export type Role = z.infer<typeof roleSchema>;

export const createRoleRequestSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(255).optional(),
  permissions: z.array(permissionRequestSchema).nonempty(),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const updateRolePermissionsRequestSchema = z.object({
  permissions: z.array(permissionRequestSchema).nonempty(),
});
export type UpdateRolePermissionsRequest = z.infer<typeof updateRolePermissionsRequestSchema>;

/* Self-service (`/v1/users/me`) */

export const updateMeRequestSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  locale: z.string().min(2).max(10).optional(),
});
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

export const addressSchema = z.object({
  id: entityIdSchema,
  line1: z.string(),
  line2: z.string().nullable().optional(),
  city: z.string(),
  region: z.string().nullable().optional(),
  postalCode: z.string(),
  countryCode: z.string().length(2),
  phone: z.string().nullable().optional(),
  isDefault: z.boolean(),
});
export type Address = z.infer<typeof addressSchema>;

export const upsertAddressRequestSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  region: z.string().optional(),
  postalCode: z.string().min(1),
  countryCode: z.string().length(2),
  phone: z.string().optional(),
  isDefault: z.boolean().optional(),
});
export type UpsertAddressRequest = z.infer<typeof upsertAddressRequestSchema>;
