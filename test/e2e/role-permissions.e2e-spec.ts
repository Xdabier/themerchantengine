/**
 * Role permission catalogue (e2e), plan G.
 *
 * Pins the three defects the catalogue reconcile closes:
 *   1. A well-formed but unenforced key (`tax:view`) used to save cleanly and
 *      gate nothing.
 *   2. A hyphenated twin (`gift-cards:view`) 400s, and must keep 400ing.
 *   3. Reading the seeded Super Admin role and PATCHing its own list straight
 *      back used to 400, because the seed granted hyphenated keys the DTO
 *      rejects, i.e. `/roles` could not save the two most important roles.
 *
 * Deliberately not appended to `rbac.e2e-spec.ts`: that suite's `beforeAll`
 * exceeds the 5 s hook timeout at HEAD (pre-existing, unrelated to this plan),
 * so every test added there would report as failed regardless of behaviour.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSION_STRINGS } from '@permissions';
import { reconcileRolePermissions } from '../../prisma/reconcile-role-permissions';
import { api, loginAs, createTestPrisma, ADMIN } from './helpers';

const CATALOGUE = new Set<string>(PERMISSION_STRINGS);

describe('Role permission catalogue (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let scratchRoleId: string;
  const scratchRoleName = `perm-catalogue-${Date.now()}`;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    const res = await api()
      .post('/v1/admin/roles')
      .set('Cookie', adminCookie)
      .send({
        name: scratchRoleName,
        description: 'Plan G catalogue guard',
        permissions: ['orders:view'],
      })
      .expect(201);
    scratchRoleId = res.body.data.id;
  }, 30_000);

  afterAll(async () => {
    // Prefix-scoped so a rejected-create that unexpectedly succeeded is cleaned
    // up too, instead of leaving a stray role behind in the test database.
    await prisma.role
      .deleteMany({ where: { name: { startsWith: 'perm-catalogue-' } } })
      .catch(() => undefined);
    await prisma.$disconnect();
  });

  describe('PATCH /v1/admin/roles/:id', () => {
    it('rejects an out-of-catalogue key that no endpoint enforces → 400', async () => {
      await api()
        .patch(`/v1/admin/roles/${scratchRoleId}`)
        .set('Cookie', adminCookie)
        .send({ permissions: ['tax:view'] })
        .expect(400);
    });

    it('rejects a hyphenated twin of a real module → 400', async () => {
      await api()
        .patch(`/v1/admin/roles/${scratchRoleId}`)
        .set('Cookie', adminCookie)
        .send({ permissions: ['gift-cards:view'] })
        .expect(400);
    });

    it('rejects the whole batch when one key is out of catalogue', async () => {
      await api()
        .patch(`/v1/admin/roles/${scratchRoleId}`)
        .set('Cookie', adminCookie)
        .send({ permissions: ['orders:view', 'rbac:manage'] })
        .expect(400);

      const persisted = await prisma.rolePermission.findMany({
        where: { roleId: scratchRoleId },
        select: { permission: true },
      });
      expect(persisted.map((p) => p.permission).sort()).toEqual(['orders:view']);
    });

    it('rejects a repeated key instead of 409ing on the unique constraint', async () => {
      await api()
        .patch(`/v1/admin/roles/${scratchRoleId}`)
        .set('Cookie', adminCookie)
        .send({ permissions: ['orders:view', 'orders:view'] })
        .expect(400);
    });

    it('accepts canonical keys and replaces the full set', async () => {
      const res = await api()
        .patch(`/v1/admin/roles/${scratchRoleId}`)
        .set('Cookie', adminCookie)
        .send({ permissions: ['orders:view', 'gift_cards:view'] })
        .expect(200);

      const saved = (res.body.data.permissions as Array<{ permission: string }>)
        .map((p) => p.permission)
        .sort();
      expect(saved).toEqual(['gift_cards:view', 'orders:view']);
    });
  });

  describe('POST /v1/admin/roles', () => {
    it('rejects an out-of-catalogue key at creation → 400', async () => {
      await api()
        .post('/v1/admin/roles')
        .set('Cookie', adminCookie)
        .send({
          name: `perm-catalogue-reject-${Date.now()}`,
          permissions: ['staff:view'],
        })
        .expect(400);
    });
  });

  describe('seeded roles round-trip', () => {
    it('saves the Super Admin role back unchanged with the full canonical catalogue', async () => {
      const listRes = await api().get('/v1/admin/roles').set('Cookie', adminCookie).expect(200);

      const superAdmin = (listRes.body.data as Array<{ id: string; name: string }>).find(
        (r) => r.name === 'Super Admin',
      );
      expect(superAdmin).toBeDefined();

      const current = (
        (superAdmin as unknown as { permissions: Array<{ permission: string }> }).permissions ?? []
      ).map((p) => p.permission);

      // Every persisted grant is canonical: the seed no longer writes the
      // hyphenated or invented keys, and the reconcile removed the old ones.
      expect(current.filter((p) => !CATALOGUE.has(p))).toEqual([]);
      expect(current).toHaveLength(PERMISSION_STRINGS.length);

      const patchRes = await api()
        .patch(`/v1/admin/roles/${superAdmin!.id}`)
        .set('Cookie', adminCookie)
        .send({ permissions: current })
        .expect(200);

      expect(patchRes.body.data.permissions).toHaveLength(PERMISSION_STRINGS.length);
    });

    // The reconcile's only privilege-GRANTING path. It is a no-op on today's
    // data (the seeded roles hold both spellings), and the tightened DTO means
    // the api can no longer persist a twin, so a direct write is the only way
    // to exercise it.
    it('carries a twin-only grant over to its canonical key before pruning it', async () => {
      const role = await prisma.role.create({
        data: {
          name: `perm-catalogue-twin-${Date.now()}`,
          description: 'Holds only the hyphenated spelling',
          permissions: {
            create: [
              { permission: 'orders:view' },
              { permission: 'gift-cards:view' },
              { permission: 'tax:view' },
            ],
          },
        },
      });

      await reconcileRolePermissions(prisma, () => undefined);

      const after = (
        await prisma.rolePermission.findMany({
          where: { roleId: role.id },
          select: { permission: true },
        })
      )
        .map((p) => p.permission)
        .sort();

      // The twin's intent survives as the canonical key; the twin itself and
      // the never-enforced key are gone.
      expect(after).toEqual(['gift_cards:view', 'orders:view']);
    });

    it('leaves no out-of-catalogue grant anywhere in RolePermission', async () => {
      const rows = await prisma.rolePermission.findMany({
        select: { permission: true, role: { select: { name: true } } },
      });
      const offenders = rows
        .filter((r) => !CATALOGUE.has(r.permission))
        .map((r) => `${r.role.name}: ${r.permission}`);
      expect(offenders).toEqual([]);
    });
  });
});
