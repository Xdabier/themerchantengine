import { adminSessionUserSchema, adminUserSchema, effectivePermissions, isStaff } from './auth';

describe('effectivePermissions', () => {
  const baseUser = adminUserSchema.parse({
    id: 'b4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
    email: 'owner@example.com',
    roles: [
      {
        id: 'b4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb',
        name: 'admin',
        permissions: ['orders:view', 'products:view'],
      },
      {
        id: 'b4f5c9a4-1a1a-4a4a-8a8a-cccccccccccc',
        name: 'support',
        permissions: ['orders:view', 'returns:create'],
      },
    ],
    permissions: ['settings:view'],
    status: 'active',
    role: 'ADMIN',
  });

  it('unions role permissions with direct permissions', () => {
    const set = effectivePermissions(baseUser);
    expect(set.has('orders:view')).toBe(true);
    expect(set.has('products:view')).toBe(true);
    expect(set.has('returns:create')).toBe(true);
    expect(set.has('settings:view')).toBe(true);
  });

  it('deduplicates overlapping permissions', () => {
    const set = effectivePermissions(baseUser);
    // orders:view appears in two roles; should be present once.
    expect([...set].filter((p) => p === 'orders:view')).toHaveLength(1);
  });

  it('returns an empty set for a user with no roles and no direct permissions', () => {
    const empty = adminUserSchema.parse({
      id: 'b4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd',
      email: 'nobody@example.com',
      roles: [],
      permissions: [],
      status: 'active',
      role: 'SUPPORT',
    });
    expect(effectivePermissions(empty).size).toBe(0);
  });
});

/**
 * Finding AD6 / AD11. The Better Auth `customSession` plugin puts `role` on
 * every session payload, and this schema had no such key, so Zod stripped it:
 * a CUSTOMER parsed into a perfectly valid `AdminUser` with empty roles and
 * permissions, the admin shell mounted, and only the server-side 403s stopped
 * anything happening. On production the auth cookie is cross-subdomain, so a
 * customer signed in on the storefront presents it to the admin host.
 */
describe('session role (finding AD6)', () => {
  const base = {
    id: 'b4f5c9a4-1a1a-4a4a-8a8a-eeeeeeeeeeee',
    email: 'someone@example.com',
    roles: [],
    permissions: [],
    status: 'active' as const,
  };

  it('parses every role the API can send', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT', 'CUSTOMER'] as const) {
      expect(adminSessionUserSchema.parse({ ...base, role }).role).toBe(role);
    }
  });

  it('keeps the role instead of stripping it off the wire', () => {
    expect(adminUserSchema.parse({ ...base, role: 'CUSTOMER' }).role).toBe('CUSTOMER');
  });

  it('rejects a session payload with no role at all, rather than defaulting one', () => {
    // Fail closed: a session whose role cannot be read is not a staff session.
    expect(() => adminSessionUserSchema.parse(base)).toThrow();
  });

  it('rejects an unknown role value', () => {
    expect(() => adminSessionUserSchema.parse({ ...base, role: 'ROOT' })).toThrow();
  });

  /**
   * Four other consumers build on `adminUserSchema`, and not all of their
   * endpoints send a role. A required key there would turn a missing field
   * into a parse throw and a "Could not load" screen, which is the drift bug
   * class this codebase has already been bitten by.
   */
  it('leaves the shared admin-user schema tolerant of a role-less payload', () => {
    expect(() => adminUserSchema.parse(base)).not.toThrow();
  });
});

describe('isStaff', () => {
  const withRole = (role: string) =>
    adminSessionUserSchema.parse({
      id: 'b4f5c9a4-1a1a-4a4a-8a8a-ffffffffffff',
      email: 'someone@example.com',
      roles: [],
      permissions: [],
      status: 'active',
      role,
    });

  it('is true for every staff role', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT']) {
      expect(isStaff(withRole(role))).toBe(true);
    }
  });

  it('is false for CUSTOMER, and only for CUSTOMER', () => {
    expect(isStaff(withRole('CUSTOMER'))).toBe(false);
  });
});
