/**
 * SEO GSC Search Analytics (e2e) — DR-17 D4.
 *
 * Exercises GET /v1/admin/seo/analytics against the real dockerized stack. The
 * GSC client is env-gated off in the test env (GSC_SUBMISSION_ENABLED unset), so
 * NO live Search Console call leaves the box — the endpoint degrades to
 * `state:'disabled'` with an empty rollup. Assertions therefore key on the
 * degrade contract + the range allowlist (400 on a bad range) + the RBAC matrix +
 * the §3.15-A `no-store` cache header, never on live `ok` data.
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, loginAs, createUserWithRole, createTestPrisma, ADMIN } from './helpers';

const ANALYTICS = '/v1/admin/seo/analytics';

describe('SEO GSC Search Analytics (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  // seo:view but NOT seo:manage — analytics is a read endpoint, so this is allowed.
  let viewerCookie: string;
  let viewerUserId: string;
  let viewerRoleId: string | undefined;
  // No seo permission at all — forbidden even from the read endpoint.
  let noSeoCookie: string;
  let noSeoUserId: string;
  let noSeoRoleId: string | undefined;

  const VIEWER_EMAIL = `seo-analytics-viewer-${crypto.randomUUID()}@e2e.test`;
  const VIEWER_PASSWORD = 'ViewerPass1!';
  const NO_SEO_EMAIL = `seo-analytics-nope-${crypto.randomUUID()}@e2e.test`;
  const NO_SEO_PASSWORD = 'NoSeoPass1!';

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    const viewer = await createUserWithRole(prisma, {
      email: VIEWER_EMAIL,
      password: VIEWER_PASSWORD,
      role: 'MANAGER',
      permissions: ['seo:view'], // explicitly NOT seo:manage
    });
    viewerUserId = viewer.userId;
    viewerRoleId = viewer.roleId;
    viewerCookie = await loginAs(VIEWER_EMAIL, VIEWER_PASSWORD);

    const noSeo = await createUserWithRole(prisma, {
      email: NO_SEO_EMAIL,
      password: NO_SEO_PASSWORD,
      role: 'MANAGER',
      permissions: ['orders:view'], // no seo:* at all
    });
    noSeoUserId = noSeo.userId;
    noSeoRoleId = noSeo.roleId;
    noSeoCookie = await loginAs(NO_SEO_EMAIL, NO_SEO_PASSWORD);
  });

  afterAll(async () => {
    for (const userId of [viewerUserId, noSeoUserId]) {
      await prisma.account.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    for (const roleId of [viewerRoleId, noSeoRoleId]) {
      if (roleId) await prisma.role.deleteMany({ where: { id: roleId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  describe('GET /analytics', () => {
    it('200 — returns the degraded disabled rollup + cache-control: no-store when GSC is env-gated off', async () => {
      const res = await api().get(ANALYTICS).set('Cookie', adminCookie).expect(200);
      expect(res.headers['cache-control']).toContain('no-store');
      const a = res.body.data;
      expect(a.state).toBe('disabled');
      expect(typeof a.detail).toBe('string'); // always populated, even when degraded
      expect(a.range).toBe('28d'); // the default window
      expect(a.totals).toBeNull();
      expect(a.asOf).toBeNull();
      expect(Array.isArray(a.series)).toBe(true);
      expect(a.series).toHaveLength(0);
      expect(Array.isArray(a.topQueries)).toBe(true);
      expect(Array.isArray(a.topPages)).toBe(true);
    });

    it('200 — readable by a seo:view-only user', async () => {
      await api().get(ANALYTICS).set('Cookie', viewerCookie).expect(200);
    });

    it('200 — ?range=7d echoes the range in the response', async () => {
      const res = await api().get(`${ANALYTICS}?range=7d`).set('Cookie', adminCookie).expect(200);
      expect(res.body.data.range).toBe('7d');
    });

    it('200 — ?range=90d passes DTO validation', async () => {
      const res = await api().get(`${ANALYTICS}?range=90d`).set('Cookie', adminCookie).expect(200);
      expect(res.body.data.range).toBe('90d');
    });

    it('400 — ?range=bogus is rejected by the @IsIn allowlist', async () => {
      await api().get(`${ANALYTICS}?range=bogus`).set('Cookie', adminCookie).expect(400);
    });

    it('403 — a user without seo:view cannot read analytics', async () => {
      await api().get(ANALYTICS).set('Cookie', noSeoCookie).expect(403);
    });

    it('401 — unauthenticated', async () => {
      await api().get(ANALYTICS).expect(401);
    });
  });
});
