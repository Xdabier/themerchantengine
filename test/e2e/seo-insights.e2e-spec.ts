/**
 * SEO monitoring reads (e2e) — DR-17 D3.
 *
 * Exercises GET /v1/admin/seo/coverage, GET /v1/admin/seo/quota and
 * POST /v1/admin/seo/health/recheck against the real dockerized stack. The
 * search-engine clients are env-gated off in the test env (GSC_SUBMISSION_ENABLED
 * / BING_API_KEY unset) so NO live network calls leave the box — every engine
 * degrades to `state:'disabled'`. Assertions therefore key on the degrade
 * contract + the RBAC matrix + the §3.15-A `no-store` cache header, never on a
 * live `ok`. AppThrottlerGuard skips throttling in the test env, so the 1/5-min
 * recheck group never trips here.
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, loginAs, createUserWithRole, createTestPrisma, ADMIN } from './helpers';

const COVERAGE = '/v1/admin/seo/coverage';
const QUOTA = '/v1/admin/seo/quota';
const RECHECK = '/v1/admin/seo/health/recheck';

describe('SEO monitoring reads (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  // seo:view but NOT seo:manage — allowed to read coverage/quota, forbidden to recheck.
  let viewerCookie: string;
  let viewerUserId: string;
  let viewerRoleId: string | undefined;
  // No seo permission at all — forbidden even from the read endpoints.
  let noSeoCookie: string;
  let noSeoUserId: string;
  let noSeoRoleId: string | undefined;

  const VIEWER_EMAIL = `seo-viewer-${crypto.randomUUID()}@e2e.test`;
  const VIEWER_PASSWORD = 'ViewerPass1!';
  const NO_SEO_EMAIL = `seo-nope-${crypto.randomUUID()}@e2e.test`;
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

  // ── GET /coverage ───────────────────────────────────────────────────────────

  describe('GET /coverage', () => {
    it('200 — returns a per-engine coverage shape, degrading disabled engines', async () => {
      const res = await api().get(COVERAGE).set('Cookie', adminCookie).expect(200);
      expect(res.headers['cache-control']).toContain('no-store');
      const { gsc, bing } = res.body.data;
      expect(['ok', 'disabled', 'error']).toContain(gsc.state);
      expect(Array.isArray(gsc.sitemaps)).toBe(true);
      expect(['ok', 'disabled', 'error']).toContain(bing.state);
      expect(Array.isArray(bing.feeds)).toBe(true);
      // Engines are env-disabled in test.
      expect(gsc.state).toBe('disabled');
      expect(bing.state).toBe('disabled');
    });

    it('200 — readable by a seo:view-only user', async () => {
      await api().get(COVERAGE).set('Cookie', viewerCookie).expect(200);
    });

    it('403 — a user without seo:view cannot read coverage', async () => {
      await api().get(COVERAGE).set('Cookie', noSeoCookie).expect(403);
    });

    it('401 — unauthenticated', async () => {
      await api().get(COVERAGE).expect(401);
    });
  });

  // ── GET /quota ────────────────────────────────────────────────────────────────

  describe('GET /quota', () => {
    it('200 — returns bing + gsc + indexnow blocks; IndexNow window is 300s', async () => {
      const res = await api().get(QUOTA).set('Cookie', adminCookie).expect(200);
      expect(res.headers['cache-control']).toContain('no-store');
      const { bing, gsc, indexnow } = res.body.data;
      expect(bing.state).toBe('disabled');
      expect(bing.dailyQuota).toBeNull();
      expect(gsc.state).toBe('disabled');
      expect(gsc.inspectCap).toBe(2000);
      expect(gsc.inspectUsed).toBe(0);
      expect(gsc.source).toBe('estimated');
      expect(indexnow.dedupWindowSeconds).toBe(300);
    });

    it('200 — readable by a seo:view-only user', async () => {
      await api().get(QUOTA).set('Cookie', viewerCookie).expect(200);
    });

    it('403 — a user without seo:view cannot read quota', async () => {
      await api().get(QUOTA).set('Cookie', noSeoCookie).expect(403);
    });

    it('401 — unauthenticated', async () => {
      await api().get(QUOTA).expect(401);
    });
  });

  // ── POST /health/recheck ──────────────────────────────────────────────────────

  describe('POST /health/recheck', () => {
    it('200 — runs a live probe and returns a fresh snapshot', async () => {
      const res = await api().post(RECHECK).set('Cookie', adminCookie).expect(200);
      expect(res.headers['cache-control']).toContain('no-store');
      const snap = res.body.data;
      expect(typeof snap.checkedAt).toBe('string');
      expect(snap.gsc.state).toBe('disabled');
      expect(snap.bing.state).toBe('disabled');
      expect(snap.publicSitemap).toBeDefined();
    });

    it('403 — a seo:view-only user cannot trigger a re-check (needs seo:manage)', async () => {
      await api().post(RECHECK).set('Cookie', viewerCookie).expect(403);
    });

    it('401 — unauthenticated', async () => {
      await api().post(RECHECK).expect(401);
    });
  });
});
