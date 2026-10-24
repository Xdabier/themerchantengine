import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
  signUpCustomer,
} from '../../../test/e2e/helpers';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-audit-log.test';
const TEST_PASSWORD = 'StrongPass1!';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Audit Log (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let viewerCookie: string;
  let customerCookie: string;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Admin user (audit_log:view + products:manage) ──
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['audit_log:view', 'products:manage', 'products:create', 'products:view'],
      firstName: 'Audit',
      lastName: 'Admin',
    });
    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);

    // ── Viewer (audit_log:view only) ──
    await createUserWithRole(prisma, {
      email: `viewer${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['audit_log:view'],
      firstName: 'Audit',
      lastName: 'Viewer',
    });
    viewerCookie = await loginAs(`viewer${TEST_SUFFIX}`, TEST_PASSWORD);

    // ── Customer (no audit_log permission) ──
    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Audit',
      lastName: 'Customer',
    });
  });

  afterAll(async () => {
    await prisma.auditLogEntry.deleteMany({
      where: { ipAddress: '::ffff:127.0.0.1' },
    });
    await prisma.user.deleteMany({ where: { email: { contains: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── Interceptor: creates audit entry on admin mutation ────────────────────

  describe('AuditLogInterceptor', () => {
    it('writes an audit entry when a product is created via admin route', async () => {
      // Perform a mutating admin action — status is irrelevant, we only check the audit entry
      await api()
        .post('/v1/admin/products')
        .set('Cookie', adminCookie)
        .send({
          name: { default: 'Audit Test Product', en: 'Audit Test Product' },
          slug: `audit-test-product-${Date.now()}`,
          price: 1000,
          currency: 'USD',
        });

      // Give the interceptor a moment to write the entry (tap is async/fire-and-forget)
      await new Promise((r) => setTimeout(r, 100));

      const entries = await prisma.auditLogEntry.findMany({
        where: { action: 'product.create', entityType: 'product' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].action).toBe('product.create');
      expect(entries[0].entityType).toBe('product');
    });
  });

  // ── GET /v1/admin/audit-log ────────────────────────────────────────────────

  describe('GET /v1/admin/audit-log', () => {
    it('returns 200 with paginated results for audit_log:view', async () => {
      const res = await api().get('/v1/admin/audit-log').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toMatchObject({
        page: 1,
        pageSize: 20,
      });
    });

    it('viewer with audit_log:view can list audit log', async () => {
      const res = await api().get('/v1/admin/audit-log').set('Cookie', viewerCookie);

      expect(res.status).toBe(200);
    });

    it('returns 403 for customer without audit_log:view', async () => {
      const res = await api().get('/v1/admin/audit-log').set('Cookie', customerCookie);

      expect(res.status).toBe(403);
    });

    it('returns 401 without auth token', async () => {
      const res = await api().get('/v1/admin/audit-log');
      expect(res.status).toBe(401);
    });

    it('filters by entityType', async () => {
      const res = await api()
        .get('/v1/admin/audit-log?entityType=product')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      // All returned entries must have entityType=product
      const entries = res.body.data as Array<{ entityType: string }>;
      entries.forEach((e) => expect(e.entityType).toBe('product'));
    });

    it('filters by action (partial match)', async () => {
      const res = await api()
        .get('/v1/admin/audit-log?action=product')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      const entries = res.body.data as Array<{ action: string }>;
      entries.forEach((e) => expect(e.action).toContain('product'));
    });

    it('filters by date range', async () => {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const res = await api()
        .get(`/v1/admin/audit-log?from=${from}&to=${to}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
    });

    it('validates pageSize does not exceed 100', async () => {
      const res = await api()
        .get('/v1/admin/audit-log?pageSize=200')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(400);
    });

    it('respects pagination', async () => {
      const res = await api()
        .get('/v1/admin/audit-log?page=1&pageSize=5')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.pageSize).toBe(5);
      expect((res.body.data as unknown[]).length).toBeLessThanOrEqual(5);
    });
  });

  // ── GET /v1/admin/audit-log/:entityType/:entityId ─────────────────────────

  describe('GET /v1/admin/audit-log/:entityType/:entityId', () => {
    it('returns entries for a known entity', async () => {
      // Seed an audit log entry directly so the test is deterministic
      const seedEntry = await prisma.auditLogEntry.create({
        data: {
          action: 'product.update',
          entityType: 'product',
          entityId: 'test-product-e2e',
          changes: { before: { name: 'Old' }, after: { name: 'New' } },
          ipAddress: '::ffff:127.0.0.1',
          userAgent: 'e2e-test',
        },
      });

      const res = await api()
        .get('/v1/admin/audit-log/product/test-product-e2e')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      const entries = res.body.data as Array<{ entityType: string; entityId: string }>;
      expect(entries.length).toBeGreaterThan(0);
      entries.forEach((e) => {
        expect(e.entityType).toBe('product');
        expect(e.entityId).toBe('test-product-e2e');
      });

      // Cleanup
      await prisma.auditLogEntry.delete({ where: { id: seedEntry.id } });
    });

    it('returns empty array for entity with no audit entries', async () => {
      const res = await api()
        .get('/v1/admin/audit-log/product/nonexistent-entity-id-xyz')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('returns 403 for customer without permission', async () => {
      const res = await api()
        .get('/v1/admin/audit-log/product/some-id')
        .set('Cookie', customerCookie);

      expect(res.status).toBe(403);
    });

    it('supports pagination on entity-specific endpoint', async () => {
      const res = await api()
        .get('/v1/admin/audit-log/product/test-entity?page=1&pageSize=10')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.pageSize).toBe(10);
    });
  });

  // ── Immutability: no update/delete endpoints ───────────────────────────────

  describe('Immutability', () => {
    it('does not expose a DELETE /v1/admin/audit-log/:id endpoint', async () => {
      const res = await api()
        .delete('/v1/admin/audit-log/some-entry-id')
        .set('Cookie', adminCookie);

      // NestJS returns 404 (not found) or 405 (method not allowed) — either is correct
      expect([404, 405]).toContain(res.status);
    });

    it('does not expose a PATCH /v1/admin/audit-log/:id endpoint', async () => {
      const res = await api()
        .patch('/v1/admin/audit-log/some-entry-id')
        .set('Cookie', adminCookie)
        .send({ action: 'tampered' });

      expect([404, 405]).toContain(res.status);
    });
  });
});
