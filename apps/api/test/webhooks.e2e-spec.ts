import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, createTestPrisma, createUserWithRole, loginAs } from '../../../test/e2e/helpers';

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-webhooks.test';
const TEST_PASSWORD = 'StrongPass1!';

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Webhooks (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let viewerCookie: string;
  let subId: string;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Admin user (settings:manage + settings:view) ──
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['settings:manage', 'settings:view'],
      firstName: 'Hook',
      lastName: 'Admin',
    });
    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);

    // ── Viewer user (settings:view only) ──
    await createUserWithRole(prisma, {
      email: `viewer${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['settings:view'],
      firstName: 'Hook',
      lastName: 'Viewer',
    });
    viewerCookie = await loginAs(`viewer${TEST_SUFFIX}`, TEST_PASSWORD);
  });

  afterAll(async () => {
    await prisma.webhookSubscription.deleteMany({ where: { url: { contains: 'e2e-webhooks' } } });
    await prisma.user.deleteMany({ where: { email: { contains: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── POST /v1/admin/webhooks ───────────────────────────────────────────────

  describe('POST /v1/admin/webhooks', () => {
    it('creates a subscription with auto-generated secret', async () => {
      const res = await api()
        .post('/v1/admin/webhooks')
        .set('Cookie', adminCookie)
        .send({
          url: 'https://e2e-webhooks.example.com/hook',
          events: ['order.created', 'order.shipped'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        url: 'https://e2e-webhooks.example.com/hook',
        events: expect.arrayContaining(['order.created', 'order.shipped']),
        isActive: true,
        failureCount: 0,
      });
      expect(res.body.data.secret).toMatch(/^[0-9a-f]{64}$/);
      subId = res.body.data.id as string;
    });

    it('rejects an HTTP (non-HTTPS) URL', async () => {
      const res = await api()
        .post('/v1/admin/webhooks')
        .set('Cookie', adminCookie)
        .send({ url: 'http://example.com/hook', events: ['order.created'] });

      expect(res.status).toBe(400);
    });

    it('rejects an internal IP URL', async () => {
      const res = await api()
        .post('/v1/admin/webhooks')
        .set('Cookie', adminCookie)
        .send({ url: 'https://192.168.1.1/hook', events: ['order.created'] });

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('WEBHOOK_URL_INTERNAL_IP');
    });

    it('rejects empty events array', async () => {
      const res = await api()
        .post('/v1/admin/webhooks')
        .set('Cookie', adminCookie)
        .send({ url: 'https://e2e-webhooks.example.com/hook', events: [] });

      expect(res.status).toBe(400);
    });

    it('rejects unknown event types', async () => {
      const res = await api()
        .post('/v1/admin/webhooks')
        .set('Cookie', adminCookie)
        .send({ url: 'https://e2e-webhooks.example.com/hook', events: ['not.a.real.event'] });

      expect(res.status).toBe(400);
    });

    it('requires settings:manage permission', async () => {
      const res = await api()
        .post('/v1/admin/webhooks')
        .set('Cookie', viewerCookie)
        .send({ url: 'https://e2e-webhooks.example.com/hook', events: ['order.created'] });

      expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
      const res = await api()
        .post('/v1/admin/webhooks')
        .send({ url: 'https://e2e-webhooks.example.com/hook', events: ['order.created'] });

      expect(res.status).toBe(401);
    });
  });

  // ── GET /v1/admin/webhooks ────────────────────────────────────────────────

  describe('GET /v1/admin/webhooks', () => {
    it('lists subscriptions (secrets omitted)', async () => {
      const res = await api().get('/v1/admin/webhooks').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toMatchObject({ page: 1 });
      // Secrets must not be exposed
      res.body.data.forEach((item: Record<string, unknown>) => {
        expect(item.secret).toBeUndefined();
      });
    });

    it('requires settings:view permission', async () => {
      const res = await api().get('/v1/admin/webhooks');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /v1/admin/webhooks/:id ────────────────────────────────────────────

  describe('GET /v1/admin/webhooks/:id', () => {
    it('returns a single subscription', async () => {
      const res = await api().get(`/v1/admin/webhooks/${subId}`).set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(subId);
    });

    it('returns 404 for unknown ID', async () => {
      const res = await api()
        .get('/v1/admin/webhooks/nonexistent-id')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /v1/admin/webhooks/:id ─────────────────────────────────────────

  describe('PATCH /v1/admin/webhooks/:id', () => {
    it('updates the event list', async () => {
      const res = await api()
        .patch(`/v1/admin/webhooks/${subId}`)
        .set('Cookie', adminCookie)
        .send({ events: ['order.cancelled', 'order.delivered'] });

      expect(res.status).toBe(200);
      expect(res.body.data.events).toEqual(
        expect.arrayContaining(['order.cancelled', 'order.delivered']),
      );
    });

    it('can re-activate a deactivated subscription', async () => {
      // First deactivate via direct DB
      await prisma.webhookSubscription.update({ where: { id: subId }, data: { isActive: false } });

      const res = await api()
        .patch(`/v1/admin/webhooks/${subId}`)
        .set('Cookie', adminCookie)
        .send({ isActive: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
    });

    it('requires settings:manage permission', async () => {
      const res = await api()
        .patch(`/v1/admin/webhooks/${subId}`)
        .set('Cookie', viewerCookie)
        .send({ events: ['order.created'] });

      expect(res.status).toBe(403);
    });
  });

  // ── POST /v1/admin/webhooks/:id/test ─────────────────────────────────────

  describe('POST /v1/admin/webhooks/:id/test', () => {
    it('enqueues a test delivery and returns eventId + deliveryId', async () => {
      const res = await api()
        .post(`/v1/admin/webhooks/${subId}/test`)
        .set('Cookie', adminCookie)
        .set('X-Idempotency-Key', randomUUID());

      expect(res.status).toBe(201);
      expect(res.body.data.eventId).toBeDefined();
      expect(res.body.data.deliveryId).toBeDefined();

      // Delivery record should exist in DB
      const delivery = await prisma.webhookDelivery.findUnique({
        where: { id: res.body.data.deliveryId as string },
      });
      expect(delivery).not.toBeNull();
      expect(delivery?.attempt).toBe(1);
    });

    it('400 IDEMPOTENCY_KEY_REQUIRED without header', async () => {
      const res = await api()
        .post(`/v1/admin/webhooks/${subId}/test`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('400 IDEMPOTENCY_KEY_MALFORMED on bad header', async () => {
      const res = await api()
        .post(`/v1/admin/webhooks/${subId}/test`)
        .set('Cookie', adminCookie)
        .set('X-Idempotency-Key', 'not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_MALFORMED');
    });

    it('same key + same caller returns the cached response on replay', async () => {
      const key = randomUUID();
      const first = await api()
        .post(`/v1/admin/webhooks/${subId}/test`)
        .set('Cookie', adminCookie)
        .set('X-Idempotency-Key', key);
      expect(first.status).toBe(201);

      const second = await api()
        .post(`/v1/admin/webhooks/${subId}/test`)
        .set('Cookie', adminCookie)
        .set('X-Idempotency-Key', key);
      expect(second.status).toBe(201);
      expect(second.body.data.eventId).toBe(first.body.data.eventId);
      expect(second.body.data.deliveryId).toBe(first.body.data.deliveryId);
    });
  });

  // ── GET /v1/admin/webhooks/:id/deliveries ─────────────────────────────────

  describe('GET /v1/admin/webhooks/:id/deliveries', () => {
    it('returns the delivery log for a subscription', async () => {
      const res = await api()
        .get(`/v1/admin/webhooks/${subId}/deliveries`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toMatchObject({ page: 1 });
      // At least the test delivery from the previous test
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('respects pagination', async () => {
      const res = await api()
        .get(`/v1/admin/webhooks/${subId}/deliveries?page=1&pageSize=1`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
      expect(res.body.meta.pageSize).toBe(1);
    });

    it('returns 404 for unknown subscription', async () => {
      const res = await api()
        .get('/v1/admin/webhooks/nonexistent-id/deliveries')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /v1/admin/webhooks/:id ─────────────────────────────────────────

  describe('DELETE /v1/admin/webhooks/:id', () => {
    it('permanently deletes a subscription', async () => {
      // Create a throwaway subscription to delete
      const createRes = await api()
        .post('/v1/admin/webhooks')
        .set('Cookie', adminCookie)
        .send({ url: 'https://e2e-webhooks.example.com/delete-me', events: ['product.deleted'] });

      const deleteId = createRes.body.data.id as string;

      const delRes = await api()
        .delete(`/v1/admin/webhooks/${deleteId}`)
        .set('Cookie', adminCookie);

      expect(delRes.status).toBe(204);

      const getRes = await api()
        .get(`/v1/admin/webhooks/${deleteId}`)
        .set('Cookie', adminCookie);

      expect(getRes.status).toBe(404);
    });
  });
});
