import { PrismaClient } from '@prisma/client';
import {
  api,
  loginAs,
  signUpCustomer,
  createUserWithRole,
  createTestPrisma,
} from '../../../test/e2e/helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUFFIX = '@e2e-rbac.test';
const PASSWORD = 'StrongPass1!';

// ── Suite ─────────────────────────────────────────────────────────────────────
//
// BA2.6 — the RBAC + ownership behaviour is unchanged by the Better Auth
// migration; this suite proves `@Permissions` 403s and the SUPER_ADMIN bypass
// still hold against the new `SessionAuthGuard`. The retired blocks that
// exercised the custom JWT stack directly — the `/v1/auth/refresh` CSRF
// contract, the `AUTH_BEARER_MISSING` / `AUTH_ACCESS_TOKEN_INVALID` /
// `AUTH_REFRESH_*` codes, the `LoginDto` length caps — are removed: those
// routes and codes no longer exist (Better Auth owns auth). The auth surface
// itself is covered by `test/e2e/auth.e2e-spec.ts`.

describe('RBAC (e2e)', () => {
  let prisma: PrismaClient;

  let superAdminCookie: string;
  let limitedStaffCookie: string;
  let customerCookie: string;
  let limitedRoleId: string;
  let createdStaffId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // Clean up previous test data.
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E-' } } });

    // ── SUPER_ADMIN test user — bypasses every permission check ──
    await createUserWithRole(prisma, {
      email: `superadmin${SUFFIX}`,
      password: PASSWORD,
      role: 'SUPER_ADMIN',
      firstName: 'Super',
      lastName: 'Admin',
    });
    superAdminCookie = await loginAs(`superadmin${SUFFIX}`, PASSWORD);

    // ── Limited-permission role (products:view + customers:view only) ──
    const limitedRole = await prisma.role.create({
      data: {
        name: 'E2E-LimitedStaff',
        description: 'E2E test: can only view products and customers',
        permissions: {
          create: [{ permission: 'products:view' }, { permission: 'customers:view' }],
        },
      },
    });
    limitedRoleId = limitedRole.id;

    // ── A customer ──
    customerCookie = await signUpCustomer(prisma, `customer${SUFFIX}`, PASSWORD);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E-' } } });
    await prisma.$disconnect();
  });

  // ── SUPER_ADMIN bypasses permission checks ────────────────────────────

  describe('SUPER_ADMIN bypass', () => {
    it('SUPER_ADMIN can access admin staff list', () => {
      return api().get('/v1/admin/staff').set('Cookie', superAdminCookie).expect(200);
    });

    it('SUPER_ADMIN can access admin roles list', () => {
      return api().get('/v1/admin/roles').set('Cookie', superAdminCookie).expect(200);
    });

    it('SUPER_ADMIN can access admin customers list', () => {
      return api().get('/v1/admin/customers').set('Cookie', superAdminCookie).expect(200);
    });
  });

  // ── Customer cannot access admin endpoints ────────────────────────────

  describe('Customer denied admin access', () => {
    it('customer gets 403 on GET /admin/staff', () => {
      return api().get('/v1/admin/staff').set('Cookie', customerCookie).expect(403);
    });

    it('customer gets 403 on POST /admin/staff', () => {
      return api()
        .post('/v1/admin/staff')
        .set('Cookie', customerCookie)
        .send({
          email: 'nope@example.com',
          password: 'Pass1234',
          firstName: 'No',
          lastName: 'Way',
          role: 'ADMIN',
        })
        .expect(403);
    });

    it('customer gets 403 on GET /admin/roles', () => {
      return api().get('/v1/admin/roles').set('Cookie', customerCookie).expect(403);
    });

    it('customer gets 403 on PATCH /admin/roles/:id', () => {
      return api()
        .patch(`/v1/admin/roles/${limitedRoleId}`)
        .set('Cookie', customerCookie)
        .send({ permissions: ['products:view'] })
        .expect(403);
    });
  });

  // ── Staff CRUD lifecycle ──────────────────────────────────────────────

  describe('Staff CRUD (SUPER_ADMIN)', () => {
    it('POST /admin/staff — creates a staff user with limited role', async () => {
      const res = await api()
        .post('/v1/admin/staff')
        .set('Cookie', superAdminCookie)
        .send({
          email: `limited${SUFFIX}`,
          password: PASSWORD,
          firstName: 'Limited',
          lastName: 'Staff',
          role: 'SUPPORT',
          roleId: limitedRoleId,
        })
        .expect(201);

      expect(res.body.data.email).toBe(`limited${SUFFIX}`);
      expect(res.body.data.role).toBe('SUPPORT');
      expect(res.body.data.passwordHash).toBeUndefined();
      createdStaffId = res.body.data.id as string;
    });

    it('GET /admin/staff — lists staff users', async () => {
      const res = await api()
        .get('/v1/admin/staff')
        .set('Cookie', superAdminCookie)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta).toBeDefined();
    });

    it('PATCH /admin/staff/:id — updates staff user', async () => {
      const res = await api()
        .patch(`/v1/admin/staff/${createdStaffId}`)
        .set('Cookie', superAdminCookie)
        .send({ firstName: 'Renamed' })
        .expect(200);

      expect(res.body.data.firstName).toBe('Renamed');
    });
  });

  // ── Limited staff: allowed vs denied ──────────────────────────────────

  describe('Limited-permission staff enforcement', () => {
    beforeAll(async () => {
      // The `limited${SUFFIX}` staff was created by the Staff CRUD suite above
      // via POST /admin/staff — `createStaff` also writes the Better Auth
      // credential Account, so the new staff user can sign in.
      limitedStaffCookie = await loginAs(`limited${SUFFIX}`, PASSWORD);
    });

    it('limited staff CAN access GET /admin/customers (has customers:view)', () => {
      return api().get('/v1/admin/customers').set('Cookie', limitedStaffCookie).expect(200);
    });

    it('limited staff gets 403 on GET /admin/staff (no admin_users:view)', () => {
      return api().get('/v1/admin/staff').set('Cookie', limitedStaffCookie).expect(403);
    });

    it('limited staff gets 403 on POST /admin/staff (no admin_users:create)', () => {
      return api()
        .post('/v1/admin/staff')
        .set('Cookie', limitedStaffCookie)
        .send({
          email: 'shouldfail@example.com',
          password: 'Pass1234',
          firstName: 'Fail',
          lastName: 'User',
          role: 'SUPPORT',
        })
        .expect(403);
    });

    it('limited staff gets 403 on PATCH /admin/roles/:id (no admin_users:manage)', () => {
      return api()
        .patch(`/v1/admin/roles/${limitedRoleId}`)
        .set('Cookie', limitedStaffCookie)
        .send({ permissions: ['products:view', 'products:create'] })
        .expect(403);
    });

    it('limited staff gets 403 on DELETE /admin/staff/:id (no admin_users:delete)', () => {
      return api()
        .delete(`/v1/admin/staff/${createdStaffId}`)
        .set('Cookie', limitedStaffCookie)
        .expect(403);
    });
  });

  // ── Role management ────────────────────────────────────────────────────

  describe('Role management (SUPER_ADMIN)', () => {
    let testRoleId: string;

    it('POST /admin/roles — creates a new role', async () => {
      const res = await api()
        .post('/v1/admin/roles')
        .set('Cookie', superAdminCookie)
        .send({
          name: 'E2E-CustomRole',
          description: 'Temporary test role',
          permissions: ['orders:view', 'orders:update'],
        })
        .expect(201);

      expect(res.body.data.name).toBe('E2E-CustomRole');
      expect(res.body.data.permissions).toHaveLength(2);
      testRoleId = res.body.data.id as string;
    });

    it('GET /admin/roles — lists all roles', async () => {
      const res = await api()
        .get('/v1/admin/roles')
        .set('Cookie', superAdminCookie)
        .expect(200);

      const names = (res.body.data as { name: string }[]).map((r) => r.name);
      expect(names).toContain('E2E-CustomRole');
    });

    it('PATCH /admin/roles/:id — replaces role permissions', async () => {
      const res = await api()
        .patch(`/v1/admin/roles/${testRoleId}`)
        .set('Cookie', superAdminCookie)
        .send({ permissions: ['products:view', 'products:create', 'products:update'] })
        .expect(200);

      expect(res.body.data.permissions).toHaveLength(3);
    });

    it('POST /admin/roles — rejects duplicate role name', () => {
      return api()
        .post('/v1/admin/roles')
        .set('Cookie', superAdminCookie)
        .send({ name: 'E2E-CustomRole', permissions: ['orders:view'] })
        .expect(409);
    });

    it('POST /admin/roles — rejects invalid permission format', () => {
      return api()
        .post('/v1/admin/roles')
        .set('Cookie', superAdminCookie)
        .send({ name: 'E2E-BadPerms', permissions: ['not_a_valid_perm'] })
        .expect(400);
    });
  });

  // ── Staff deactivation ────────────────────────────────────────────────

  describe('Staff deactivation', () => {
    it('DELETE /admin/staff/:id — deactivates staff user', () => {
      return api()
        .delete(`/v1/admin/staff/${createdStaffId}`)
        .set('Cookie', superAdminCookie)
        .expect(204);
    });

    it('a deactivated staff member is rejected on a guarded route (AUTH_USER_DEACTIVATED)', async () => {
      // Better Auth itself will still issue a session on sign-in — it does not
      // know about `isActive` — but `SessionAuthGuard` loads the user fresh on
      // every request and rejects a deactivated account with the typed code.
      const cookie = await loginAs(`limited${SUFFIX}`, PASSWORD);
      const res = await api().get('/v1/admin/customers').set('Cookie', cookie);

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('AUTH_USER_DEACTIVATED');
    });
  });

  // ── Unauthenticated + insufficient-permission codes ───────────────────

  describe('Auth guard codes', () => {
    it('GET /admin/staff without a session returns 401 AUTH_UNAUTHENTICATED', async () => {
      const res = await api().get('/v1/admin/staff');
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('AUTH_UNAUTHENTICATED');
    });

    it('GET /admin/staff with a customer session returns 403 AUTH_PERMISSION_INSUFFICIENT', async () => {
      const res = await api().get('/v1/admin/staff').set('Cookie', customerCookie);
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('AUTH_PERMISSION_INSUFFICIENT');
    });
  });
});
