/**
 * SEO per-product URL Inspection (e2e) — DR-17 D5.
 *
 * Exercises GET /v1/admin/seo/url-inspection against the real dockerized stack.
 * The GSC client is env-gated off in the test env (GSC_SUBMISSION_ENABLED unset),
 * so NO live Search Console call leaves the box — the endpoint degrades to
 * `state:'disabled'`. Assertions therefore key on the degrade contract + the
 * url|productId cardinality (400s) + the locale allowlist + the RBAC matrix + the
 * §3.15-A `no-store` cache header, never on live `ok` data.
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, loginAs, createUserWithRole, createTestPrisma, ADMIN } from './helpers';

const INSPECT = '/v1/admin/seo/url-inspection';

describe('SEO URL Inspection (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let baseOrigin: string;
  let activeProductId: string;
  let tempProductId: string | undefined;
  // seo:view but NOT seo:manage — inspection is a read endpoint, so this is allowed.
  let viewerCookie: string;
  let viewerUserId: string;
  let viewerRoleId: string | undefined;
  // No seo permission at all — forbidden even from the read endpoint.
  let noSeoCookie: string;
  let noSeoUserId: string;
  let noSeoRoleId: string | undefined;

  const VIEWER_EMAIL = `seo-inspect-viewer-${crypto.randomUUID()}@e2e.test`;
  const VIEWER_PASSWORD = 'ViewerPass1!';
  const NO_SEO_EMAIL = `seo-inspect-nope-${crypto.randomUUID()}@e2e.test`;
  const NO_SEO_PASSWORD = 'NoSeoPass1!';

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Resolve the storefront base the API uses (env-independent) from the public
    // sitemap index so the url-target same-origin check is satisfied.
    const sitemap = await api().get('/v1/sitemap_index.xml').expect(200);
    const firstLoc = /<loc>([^<]+)<\/loc>/.exec(sitemap.text)?.[1];
    baseOrigin = firstLoc ? new URL(firstLoc).origin : 'http://localhost:53300';

    // Create a temp ACTIVE product so the productId target resolves to a real slug.
    const slug = `seo-inspect-e2e-${crypto.randomUUID().slice(0, 8)}`;
    const productRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'SEO Inspect E2E Product' },
        slug,
        status: 'ACTIVE',
        variants: [{ sku: `SKU-${slug}`, price: 10, isDefault: true, isActive: true }],
      });
    if (productRes.status !== 201) {
      throw new Error(
        `[seo-url-inspection e2e] temp product creation failed: ${productRes.status} ${JSON.stringify(productRes.body)}`,
      );
    }
    tempProductId = productRes.body.data.id as string;
    activeProductId = tempProductId;

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
    if (tempProductId) {
      await api()
        .delete(`/v1/admin/products/${tempProductId}`)
        .set('Cookie', adminCookie)
        .catch(() => undefined);
    }
    for (const userId of [viewerUserId, noSeoUserId]) {
      await prisma.account.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    for (const roleId of [viewerRoleId, noSeoRoleId]) {
      if (roleId) await prisma.role.deleteMany({ where: { id: roleId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  describe('GET /url-inspection', () => {
    it('200 — ?url= degrades to disabled + cache-control: no-store when GSC is env-gated off', async () => {
      const url = `${baseOrigin}/en/catalog/product/anything`;
      const res = await api()
        .get(`${INSPECT}?url=${encodeURIComponent(url)}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.headers['cache-control']).toContain('no-store');
      const i = res.body.data;
      expect(i.state).toBe('disabled');
      expect(typeof i.detail).toBe('string');
      expect(i.verdict).toBeNull();
    });

    it('200 — ?productId= resolves a real active product and degrades to disabled', async () => {
      const res = await api()
        .get(`${INSPECT}?productId=${encodeURIComponent(activeProductId)}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.body.data.state).toBe('disabled');
    });

    it('200 — ?productId=&locale=en is accepted by the DTO', async () => {
      const res = await api()
        .get(`${INSPECT}?productId=${encodeURIComponent(activeProductId)}&locale=en`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.data.state).toBe('disabled');
    });

    it('200 — readable by a seo:view-only user', async () => {
      const url = `${baseOrigin}/en/catalog/product/anything`;
      await api()
        .get(`${INSPECT}?url=${encodeURIComponent(url)}`)
        .set('Cookie', viewerCookie)
        .expect(200);
    });

    it('400 — neither url nor productId → SEO_NO_INSPECT_TARGET', async () => {
      const res = await api().get(INSPECT).set('Cookie', adminCookie).expect(400);
      expect(res.body.error.code).toBe('SEO_NO_INSPECT_TARGET');
    });

    it('400 — both url and productId → SEO_MULTIPLE_INSPECT_TARGETS', async () => {
      const url = `${baseOrigin}/en/catalog/product/anything`;
      const res = await api()
        .get(`${INSPECT}?url=${encodeURIComponent(url)}&productId=${activeProductId}`)
        .set('Cookie', adminCookie)
        .expect(400);
      expect(res.body.error.code).toBe('SEO_MULTIPLE_INSPECT_TARGETS');
    });

    it('400 — ?locale=bogus is rejected by the @IsIn allowlist', async () => {
      await api()
        .get(`${INSPECT}?productId=${activeProductId}&locale=bogus`)
        .set('Cookie', adminCookie)
        .expect(400);
    });

    it('403 — a user without seo:view cannot inspect', async () => {
      const url = `${baseOrigin}/en/catalog/product/anything`;
      await api()
        .get(`${INSPECT}?url=${encodeURIComponent(url)}`)
        .set('Cookie', noSeoCookie)
        .expect(403);
    });

    it('401 — unauthenticated', async () => {
      const url = `${baseOrigin}/en/catalog/product/anything`;
      await api()
        .get(`${INSPECT}?url=${encodeURIComponent(url)}`)
        .expect(401);
    });
  });
});
