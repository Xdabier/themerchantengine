/**
 * Audit-log actor search (e2e), plan G phase G3.
 *
 * The Actor column has always rendered the joined user's name, but the filter
 * accepted only an exact user id, so an operator could read a name and not
 * search for it. These pin the new `actor` param end to end against the real
 * database.
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, loginAs, createTestPrisma, ADMIN } from './helpers';

interface AuditRow {
  userId: string | null;
  user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
}

describe('Audit log actor search (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  const roleName = `audit-actor-${crypto.randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Any successful admin mutation writes an AuditLogEntry via the global
    // interceptor, giving this suite a row whose actor is the seeded admin.
    await api()
      .post('/v1/admin/roles')
      .set('Cookie', adminCookie)
      .send({ name: roleName, permissions: ['orders:view'] })
      .expect(201);
  }, 30_000);

  afterAll(async () => {
    await prisma.role.deleteMany({ where: { name: roleName } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('finds entries by the actor first name shown in the Actor column', async () => {
    const res = await api()
      .get('/v1/admin/audit-log')
      .query({ actor: 'Badii' })
      .set('Cookie', adminCookie)
      .expect(200);

    const rows = res.body.data as AuditRow[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const haystack = [row.user?.firstName, row.user?.lastName, row.user?.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      expect(haystack).toContain('badii');
    }
  });

  it('matches case-insensitively and on the email too', async () => {
    const res = await api()
      .get('/v1/admin/audit-log')
      .query({ actor: 'ADMIN@MERCHANTS.TEST' })
      .set('Cookie', adminCookie)
      .expect(200);

    const rows = res.body.data as AuditRow[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.user?.email?.toLowerCase()).toBe('admin@merchants.test');
    }
  });

  it('returns nothing for an actor nobody matches', async () => {
    const res = await api()
      .get('/v1/admin/audit-log')
      .query({ actor: `nobody-matches-${crypto.randomUUID()}` })
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('treats the literal "system" as the entries with no user, plus anyone named System', async () => {
    const res = await api()
      .get('/v1/admin/audit-log')
      .query({ actor: 'system' })
      .set('Cookie', adminCookie)
      .expect(200);

    // A staff member can name themselves "System", so the filter is a superset
    // rather than a strict userId-is-null match, which would hide them.
    for (const row of res.body.data as AuditRow[]) {
      const named = [row.user?.firstName, row.user?.lastName, row.user?.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes('system');
      expect(row.userId === null || named).toBe(true);
    }
  });

  it('returns nothing when an explicit userId contradicts actor=system', async () => {
    const admin = await prisma.user.findUnique({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const res = await api()
      .get('/v1/admin/audit-log')
      .query({ userId: admin!.id, actor: 'system' })
      .set('Cookie', adminCookie)
      .expect(200);

    // The `system` term must not silently overwrite the userId filter.
    expect(res.body.meta.total).toBe(0);
  });

  it('rejects an over-long actor term', async () => {
    await api()
      .get('/v1/admin/audit-log')
      .query({ actor: 'x'.repeat(121) })
      .set('Cookie', adminCookie)
      .expect(400);
  });

  it('still supports the exact userId filter used by entity deep links', async () => {
    const admin = await prisma.user.findUnique({
      where: { email: ADMIN.email },
      select: { id: true },
    });
    const res = await api()
      .get('/v1/admin/audit-log')
      .query({ userId: admin!.id })
      .set('Cookie', adminCookie)
      .expect(200);

    for (const row of res.body.data as AuditRow[]) {
      expect(row.userId).toBe(admin!.id);
    }
  });
});
