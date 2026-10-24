/**
 * SEO manual reindex submit (e2e) — DR-17 D2.
 *
 * Exercises POST /v1/admin/seo/submit against the real dockerized stack. The
 * search-engine HTTP clients are env-gated (INDEXNOW_KEY / GSC_SUBMISSION_ENABLED
 * / BING_API_KEY are unset in the test env) so NO live network calls are made —
 * each engine fail-opens to a `disabled`/`unset` result, which a MANUAL submit
 * still records to the durable audit log. Assertions therefore key on response
 * shape + audit-row presence + the RBAC / idempotency / validation contract,
 * never on a live `accepted:true`.
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, loginAs, createUserWithRole, createTestPrisma, ADMIN } from './helpers';

const SUBMIT = '/v1/admin/seo/submit';
const newKey = () => crypto.randomUUID();

describe('SEO manual submit (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let baseOrigin: string;
  let activeProductId: string;
  /** UUID-based product created via the admin API for productIds target tests. */
  let tempProductId: string | undefined;
  let staffCookie: string;
  let staffUserId: string;
  let staffRoleId: string | undefined;
  // A second, distinct admin WITH seo:manage — for the cross-caller idempotency 403.
  let adminBCookie: string;
  let adminBUserId: string;
  let adminBRoleId: string | undefined;

  const STAFF_EMAIL = `seo-staff-${crypto.randomUUID()}@e2e.test`;
  const STAFF_PASSWORD = 'StaffPass1!';
  const ADMIN_B_EMAIL = `seo-adminb-${crypto.randomUUID()}@e2e.test`;
  const ADMIN_B_PASSWORD = 'AdminB1Pass!';

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Discover the storefront base the API resolved (env-independent) from the
    // public sitemap index, so the url-target same-origin check is satisfied.
    const sitemap = await api().get('/v1/sitemap_index.xml').expect(200);
    const firstLoc = /<loc>([^<]+)<\/loc>/.exec(sitemap.text)?.[1];
    baseOrigin = firstLoc ? new URL(firstLoc).origin : 'http://localhost:53300';

    // Create a temp ACTIVE product via the admin API so the ID is a proper UUID v4
    // (the test-seed uses legacy string IDs like "prod-wallet" which fail the
    // @IsUUID('4') validator on the productIds DTO field).
    const slug = `seo-e2e-${crypto.randomUUID().slice(0, 8)}`;
    const productRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'SEO E2E Test Product' },
        slug,
        status: 'ACTIVE',
        variants: [{ sku: `SKU-${slug}`, price: 10, isDefault: true, isActive: true }],
      });
    if (productRes.status !== 201) {
      throw new Error(
        `[seo-submit e2e] temp product creation failed: ${productRes.status} ${JSON.stringify(productRes.body)}`,
      );
    }
    tempProductId = productRes.body.data.id as string;
    activeProductId = tempProductId;

    const created = await createUserWithRole(prisma, {
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
      role: 'MANAGER',
      permissions: ['seo:view'], // explicitly NOT seo:manage
    });
    staffUserId = created.userId;
    staffRoleId = created.roleId;
    staffCookie = await loginAs(STAFF_EMAIL, STAFF_PASSWORD);

    const adminB = await createUserWithRole(prisma, {
      email: ADMIN_B_EMAIL,
      password: ADMIN_B_PASSWORD,
      role: 'MANAGER',
      permissions: ['seo:manage', 'seo:view'],
    });
    adminBUserId = adminB.userId;
    adminBRoleId = adminB.roleId;
    adminBCookie = await loginAs(ADMIN_B_EMAIL, ADMIN_B_PASSWORD);
  });

  afterAll(async () => {
    // Delete the temp product seeded for this suite (real DELETE via admin API).
    if (tempProductId) {
      await api()
        .delete(`/v1/admin/products/${tempProductId}`)
        .set('Cookie', adminCookie)
        .catch(() => undefined);
    }
    for (const userId of [staffUserId, adminBUserId]) {
      await prisma.seoSubmission.deleteMany({ where: { actorId: userId } }).catch(() => undefined);
      await prisma.account.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    for (const roleId of [staffRoleId, adminBRoleId]) {
      if (roleId) await prisma.role.deleteMany({ where: { id: roleId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('200 — sitemap target fans out to GSC + Bing and records a manual row per engine', async () => {
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ sitemap: true })
      .expect(200);

    expect(res.body.data.dryRun).toBe(false);
    expect(res.body.data.targetType).toBe('sitemap');
    expect(res.body.data.results.map((r: { engine: string }) => r.engine).sort()).toEqual([
      'bing',
      'gsc',
    ]);

    const rows = await prisma.seoSubmission.findMany({
      where: { trigger: 'manual', targetType: 'sitemap' },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.actorId !== null)).toBe(true);
  });

  it('200 — products target resolves to IndexNow and records a manual row with actorId', async () => {
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ productIds: [activeProductId] })
      .expect(200);

    expect(res.body.data.targetType).toBe('products');
    expect(res.body.data.results.map((r: { engine: string }) => r.engine)).toEqual(['indexnow']);

    const row = await prisma.seoSubmission.findFirst({
      where: { trigger: 'manual', targetType: 'products' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.actorId).toBeTruthy();
  });

  it('200 — url target (same-origin) submits to IndexNow only', async () => {
    const url = `${baseOrigin}/en/catalog/product/${activeProductId}`;
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ url })
      .expect(200);

    expect(res.body.data.targetType).toBe('url');
    expect(res.body.data.results.map((r: { engine: string }) => r.engine)).toEqual(['indexnow']);
  });

  it('200 — dryRun previews without writing any audit row', async () => {
    const url = `${baseOrigin}/en/catalog/product/dryrun-${crypto.randomUUID()}`;
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ url, dryRun: true })
      .expect(200);

    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.results[0].reason).toBe('dry run');
    const written = await prisma.seoSubmission.count({ where: { targetRef: url } });
    expect(written).toBe(0);
  });

  it('200 — idempotent replay returns the cached response and writes no second row', async () => {
    const key = newKey();
    const before = await prisma.seoSubmission.count({
      where: { trigger: 'manual', targetType: 'sitemap' },
    });

    const first = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', key)
      .send({ sitemap: true })
      .expect(200);

    const replay = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', key)
      .send({ sitemap: true })
      .expect(200);

    expect(replay.body.data).toEqual(first.body.data);
    const after = await prisma.seoSubmission.count({
      where: { trigger: 'manual', targetType: 'sitemap' },
    });
    expect(after - before).toBe(2); // only the first call wrote (gsc + bing)
  });

  it('403 — same key used by a different caller (anti-leakage)', async () => {
    const key = newKey();
    await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', key)
      .send({ sitemap: true })
      .expect(200);

    // adminB (distinct user, also has seo:manage) reuses adminA's key.
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminBCookie)
      .set('X-Idempotency-Key', key)
      .send({ sitemap: true })
      .expect(403);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_FORBIDDEN');
  });

  it('400 — engines narrowed to empty for the target (SEO_NO_APPLICABLE_ENGINE)', async () => {
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ url: `${baseOrigin}/en/x`, engines: ['gsc'] })
      .expect(400);
    expect(res.body.error.code).toBe('SEO_NO_APPLICABLE_ENGINE');
  });

  // Product IDs are CUIDs (not UUID v4), so string validation now covers them.
  // Non-string elements (e.g. a JSON number) still get rejected by @IsString({ each: true }).
  it('400 — class-validator rejects a numeric element in productIds', async () => {
    await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ productIds: [12345] })
      .expect(400);
  });

  it('400 — class-validator rejects an unknown engine', async () => {
    await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ sitemap: true, engines: ['yandex'] })
      .expect(400);
  });

  it('409 — same key, different body', async () => {
    const key = newKey();
    await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', key)
      .send({ sitemap: true })
      .expect(200);

    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', key)
      .send({ productIds: [activeProductId] })
      .expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('400 — missing X-Idempotency-Key header', async () => {
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .send({ sitemap: true })
      .expect(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('400 — malformed X-Idempotency-Key', async () => {
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', 'not-a-uuid')
      .send({ sitemap: true })
      .expect(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_MALFORMED');
  });

  it('400 — no target', async () => {
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('SEO_NO_TARGET');
  });

  it('400 — multiple targets', async () => {
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ url: `${baseOrigin}/en/x`, sitemap: true })
      .expect(400);
    expect(res.body.error.code).toBe('SEO_MULTIPLE_TARGETS');
  });

  it('400 — foreign-origin url is rejected', async () => {
    const res = await api()
      .post(SUBMIT)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ url: 'https://evil.example.org/en/catalog/product/x' })
      .expect(400);
    expect(res.body.error.code).toBe('SEO_FOREIGN_URL');
  });

  it('401 — unauthenticated', async () => {
    await api().post(SUBMIT).set('X-Idempotency-Key', newKey()).send({ sitemap: true }).expect(401);
  });

  it('403 — staff without seo:manage', async () => {
    await api()
      .post(SUBMIT)
      .set('Cookie', staffCookie)
      .set('X-Idempotency-Key', newKey())
      .send({ sitemap: true })
      .expect(403);
  });
});
