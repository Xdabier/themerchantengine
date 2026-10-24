import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  api,
  createTestPrisma,
  loginAs,
  signUpCustomer,
  ADMIN,
  DISABLED_LOCALE,
  STORE_CONFIG,
  STORE_CURRENCY,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';
import { E2E_BETTER_AUTH_SECRET } from '../../../test/e2e/env';
import { signUnsubscribeToken } from '../src/modules/mail/unsubscribe-token.util';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-notifications.test';
const TEST_PASSWORD = 'StrongPass1!';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Notifications (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let customerCookie: string;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Admin user ──
    // The admin notification routes are guarded by `notifications:view` /
    // `notifications:manage`; the seeded SUPER_ADMIN bypasses every permission
    // check, matching the original spec's intent of an admin that can read and
    // mutate the notification feed.
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // ── Customer user ──
    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Notif',
      lastName: 'Customer',
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { user: { email: ADMIN.email } },
    });
    await prisma.notification.deleteMany({
      where: { user: { email: { contains: TEST_SUFFIX } } },
    });
    // NE1 kill-switch fixtures: send-log rows + gift cards minted by the gate specs.
    await prisma.notificationLog.deleteMany({
      where: { recipient: { contains: TEST_SUFFIX } },
    });
    await prisma.giftCardTransaction.deleteMany({
      where: { giftCard: { recipientEmail: { contains: TEST_SUFFIX } } },
    });
    await prisma.giftCard.deleteMany({
      where: { recipientEmail: { contains: TEST_SUFFIX } },
    });
    // Restore the giftcard.purchase flow to its enabled baseline.
    await prisma.notificationTemplate
      .update({ where: { code: 'giftcard.purchase' }, data: { sendEnabled: true } })
      .catch(() => undefined);
    // NE6: send-test logs to the admin's own inbox + the pauseAll settings row.
    await prisma.notificationLog.deleteMany({ where: { recipient: ADMIN.email } });
    await prisma.storeSetting.deleteMany({ where: { group: 'notifications' } });
    await prisma.user.deleteMany({ where: { email: { contains: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── GET /v1/admin/notifications ────────────────────────────────────────────

  describe('GET /v1/admin/notifications', () => {
    it('returns 200 with paginated notifications for authenticated user', async () => {
      const res = await api().get('/v1/admin/notifications').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toMatchObject({
        page: 1,
        pageSize: 20,
      });
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 401 without auth token', async () => {
      const res = await api().get('/v1/admin/notifications');
      expect(res.status).toBe(401);
    });

    it('shows unread notifications first', async () => {
      const admin = await prisma.user.findUnique({
        where: { email: ADMIN.email },
      });

      // Create test notifications
      await prisma.notification.create({
        data: {
          userId: admin!.id,
          type: 'NEW_ORDER',
          title: { default: 'Test 1' },
          isRead: true,
        },
      });
      await prisma.notification.create({
        data: {
          userId: admin!.id,
          type: 'NEW_ORDER',
          title: { default: 'Test 2' },
          isRead: false,
        },
      });

      const res = await api().get('/v1/admin/notifications').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      // First unread notification should come before read ones
      const data = res.body.data as Array<{ isRead: boolean }>;
      const firstUnread = data.findIndex((n) => !n.isRead);
      const firstRead = data.findIndex((n) => n.isRead);
      if (firstUnread >= 0 && firstRead >= 0) {
        expect(firstUnread).toBeLessThan(firstRead);
      }
    });

    it('filters by isRead=false', async () => {
      const res = await api()
        .get('/v1/admin/notifications?isRead=false')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      const data = res.body.data as Array<{ isRead: boolean }>;
      data.forEach((n) => expect(n.isRead).toBe(false));
    });

    it('respects pagination', async () => {
      const res = await api()
        .get('/v1/admin/notifications?page=1&pageSize=5')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.pageSize).toBe(5);
    });
  });

  // ── PATCH /v1/admin/notifications/:id/read ─────────────────────────────────

  describe('PATCH /v1/admin/notifications/:id/read', () => {
    it('marks a notification as read', async () => {
      const admin = await prisma.user.findUnique({
        where: { email: ADMIN.email },
      });

      const notif = await prisma.notification.create({
        data: {
          userId: admin!.id,
          type: 'NEW_ORDER',
          title: { default: 'Test' },
          isRead: false,
        },
      });

      const res = await api()
        .patch(`/v1/admin/notifications/${notif.id}/read`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true });

      const updated = await prisma.notification.findUnique({
        where: { id: notif.id },
      });
      expect(updated!.isRead).toBe(true);
      expect(updated!.readAt).not.toBeNull();
    });

    it('returns 401 without auth token', async () => {
      const res = await api().patch('/v1/admin/notifications/some-id/read').send();

      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /v1/admin/notifications/read-all ─────────────────────────────────

  describe('PATCH /v1/admin/notifications/read-all', () => {
    it('marks all unread notifications as read', async () => {
      const admin = await prisma.user.findUnique({
        where: { email: ADMIN.email },
      });

      // Create unread notifications
      await prisma.notification.createMany({
        data: [
          { userId: admin!.id, type: 'NEW_ORDER', title: { default: 'Test 1' }, isRead: false },
          { userId: admin!.id, type: 'NEW_ORDER', title: { default: 'Test 2' }, isRead: false },
          { userId: admin!.id, type: 'NEW_ORDER', title: { default: 'Test 3' }, isRead: true },
        ],
      });

      const res = await api().patch('/v1/admin/notifications/read-all').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true });

      const unread = await prisma.notification.count({
        where: { userId: admin!.id, isRead: false },
      });
      expect(unread).toBe(0);
    });

    it('returns 401 without auth token', async () => {
      const res = await api().patch('/v1/admin/notifications/read-all').send();

      expect(res.status).toBe(401);
    });
  });

  // ── GET /v1/admin/notifications/unread-count ───────────────────────────────

  describe('GET /v1/admin/notifications/unread-count', () => {
    it('returns count of unread notifications', async () => {
      const res = await api()
        .get('/v1/admin/notifications/unread-count')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('unreadCount');
      expect(typeof res.body.data.unreadCount).toBe('number');
      expect(res.body.data.unreadCount).toBeGreaterThanOrEqual(0);
    });

    it('returns 401 without auth token', async () => {
      const res = await api().get('/v1/admin/notifications/unread-count');

      expect(res.status).toBe(401);
    });
  });

  // ── Isolation: users see only their own notifications ───────────────────────

  describe('User Isolation', () => {
    it('users see only their own notifications', async () => {
      const admin = await prisma.user.findUnique({
        where: { email: ADMIN.email },
      });

      // Create notification for admin only
      await prisma.notification.create({
        data: {
          userId: admin!.id,
          type: 'NEW_ORDER',
          title: { default: 'Admin only' },
        },
      });

      // Admin sees their notification — title is resolved to a string by the TranslatableInterceptor
      const adminRes = await api().get('/v1/admin/notifications').set('Cookie', adminCookie);
      const adminNotifs = adminRes.body.data as Array<{ title: string }>;
      const hasAdminNotif = adminNotifs.some((n) => n.title === 'Admin only');
      expect(hasAdminNotif).toBe(true);

      // Customer cannot access admin notifications endpoint — 403
      const customerRes = await api().get('/v1/admin/notifications').set('Cookie', customerCookie);
      expect(customerRes.status).toBe(403);
    });
  });

  // ── NE1: per-feature kill-switch in MailService.enqueue ─────────────────────
  //
  // Real-DB proof that toggling a flow via the admin PATCH governs sends. The
  // non-locked `giftcard.purchase` flow is driven through a real customer
  // purchase (POST /v1/gift-cards/purchase → giftcard.purchased event →
  // MailDispatchListener → MailService.enqueue). The observable signal is the
  // NotificationLog status:
  // `skipped` when the gate trips (no BullMQ job), `queued` when it lets the
  // send through. The admin PATCH is the in-process path that invalidates the
  // flag cache, so the gate sees the new flag on the next send.
  describe('NE1 email kill-switch', () => {
    async function giftcardTemplateId(): Promise<string> {
      const tpl = await prisma.notificationTemplate.findUnique({
        where: { code: 'giftcard.purchase' },
      });
      expect(tpl).not.toBeNull();
      return tpl!.id;
    }

    async function setSendEnabled(id: string, sendEnabled: boolean): Promise<void> {
      const res = await api()
        .patch(`/v1/admin/notifications/templates/${id}`)
        .set('Cookie', adminCookie)
        .send({ sendEnabled });
      expect(res.status).toBe(200);
    }

    /**
     * Issue a purchaser-backed gift card, which is what fires the
     * `giftcard.purchase` flow this block is testing.
     *
     * It used to go through `POST /v1/gift-cards/purchase`, removed at DR-30
     * because it minted value with no payment. The admin issuance route emits
     * the same event on the same condition, a card with both a recipient and a
     * purchaser, so the flow under test is unchanged; only the door it comes
     * through is.
     */
    async function purchaseGiftCardTo(recipient: string): Promise<void> {
      const customer = await prisma.user.findFirst({
        where: { email: `customer${TEST_SUFFIX}` },
        select: { id: true },
      });
      expect(customer).not.toBeNull();

      const res = await api().post('/v1/admin/gift-cards').set('Cookie', adminCookie).send({
        initialBalance: 50,
        currency: STORE_CURRENCY,
        recipientEmail: recipient,
        purchasedBy: customer!.id,
      });
      expect(res.status).toBe(201);
    }

    /** Poll for the giftcard.purchase send-log row to the given recipient. */
    async function waitForPurchaseLog(recipient: string): Promise<{ status: string } | null> {
      for (let i = 0; i < 40; i++) {
        const row = await prisma.notificationLog.findFirst({
          where: { templateCode: 'giftcard.purchase', recipient },
          orderBy: { sentAt: 'desc' },
          select: { status: true },
        });
        if (row) return row;
        await sleep(150);
      }
      return null;
    }

    it('disabled flow → NotificationLog status=skipped, no send', async () => {
      const id = await giftcardTemplateId();
      await setSendEnabled(id, false);

      const recipient = `gate-skip-${randomUUID()}${TEST_SUFFIX}`;
      await purchaseGiftCardTo(recipient);

      const log = await waitForPurchaseLog(recipient);
      expect(log).not.toBeNull();
      expect(log!.status).toBe('skipped');
    });

    it('enabled flow → NotificationLog status=queued (job added)', async () => {
      const id = await giftcardTemplateId();
      await setSendEnabled(id, true);

      const recipient = `gate-send-${randomUUID()}${TEST_SUFFIX}`;
      await purchaseGiftCardTo(recipient);

      const log = await waitForPurchaseLog(recipient);
      expect(log).not.toBeNull();
      // queued = handed to BullMQ; the worker may have already advanced it.
      expect(['queued', 'sent', 'delivered']).toContain(log!.status);
    });

    it('admin cannot disable a locked auth flow (400)', async () => {
      // Lock the row (the migration + seed already do this in prod; pin it here
      // so the test is independent of provisioning order).
      const locked = await prisma.notificationTemplate.update({
        where: { code: 'auth.password-reset' },
        data: { isLocked: true },
      });

      const res = await api()
        .patch(`/v1/admin/notifications/templates/${locked.id}`)
        .set('Cookie', adminCookie)
        .send({ sendEnabled: false });

      expect(res.status).toBe(400);

      // The flag is unchanged — a locked flow stays sendable.
      const after = await prisma.notificationTemplate.findUnique({
        where: { code: 'auth.password-reset' },
        select: { sendEnabled: true },
      });
      expect(after!.sendEnabled).toBe(true);
    });
  });

  // ── NE2: real admin resend + log↔template linkage ───────────────────────────
  //
  // The old stub fabricated a terminal status='sent' NotificationLog row and
  // enqueued nothing. NE2 makes resend() reconstruct the original send and push
  // it through the genuine enqueue → BullMQ → Resend pipeline, keyed by a stable
  // `resend:<logId>` dedupe key so a double-click never double-sends.
  describe('NE2 real resend', () => {
    it('re-enqueues a genuine job from the original log and is idempotent', async () => {
      const recipient = `resend-${randomUUID()}${TEST_SUFFIX}`;
      const tpl = await prisma.notificationTemplate.findUnique({
        where: { code: 'giftcard.purchase' },
      });
      expect(tpl).not.toBeNull();

      // Keep the flow sendable (sibling NE1 specs toggle it).
      await api()
        .patch(`/v1/admin/notifications/templates/${tpl!.id}`)
        .set('Cookie', adminCookie)
        .send({ sendEnabled: true });

      // Seed an original "delivered" send-log row, as if a purchase had gone out.
      const original = await prisma.notificationLog.create({
        data: {
          templateId: tpl!.id,
          templateCode: 'giftcard.purchase',
          channel: 'email',
          recipient,
          status: 'delivered',
          metadata: { locale: 'en', variables: { code: 'GC-RESEND' } },
        },
      });

      // ── First resend ──
      const res1 = await api()
        .post(`/v1/admin/notifications/log/${original.id}/resend`)
        .set('Cookie', adminCookie);
      expect(res1.status).toBe(200);
      expect(res1.body.data.recipient).toBe(recipient);
      expect(res1.body.data.status).toBe('queued');
      const resendLogId = res1.body.data.logId as string;
      expect(resendLogId).toBeDefined();
      expect(resendLogId).not.toBe(original.id);

      // No fabricated status='sent' { resendOf } row — that was the stub's lie.
      const allRows = await prisma.notificationLog.findMany({ where: { recipient } });
      const fabricated = allRows.find(
        (r) =>
          r.status === 'sent' && (r.metadata as Record<string, unknown>)?.resendOf === original.id,
      );
      expect(fabricated).toBeUndefined();

      // Exactly one NEW audit row — the genuine enqueue row — and it links back
      // to its template (NE2 log↔template linkage).
      const newRows = allRows.filter((r) => r.id !== original.id);
      expect(newRows).toHaveLength(1);
      expect(newRows[0].id).toBe(resendLogId);
      expect(newRows[0].templateId).toBe(tpl!.id);
      expect(['queued', 'sent', 'delivered']).toContain(newRows[0].status);

      // ── Second resend → idempotent: same logId, no second audit row. ──
      const res2 = await api()
        .post(`/v1/admin/notifications/log/${original.id}/resend`)
        .set('Cookie', adminCookie);
      expect(res2.status).toBe(200);
      expect(res2.body.data.logId).toBe(resendLogId);

      const afterSecond = await prisma.notificationLog.findMany({
        where: { recipient, id: { not: original.id } },
      });
      expect(afterSecond).toHaveLength(1);
    });

    it('404s when the log entry is unknown', async () => {
      const res = await api()
        .post(`/v1/admin/notifications/log/${randomUUID()}/resend`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(404);
    });

    it('returns 401 without an auth token', async () => {
      const res = await api().post(`/v1/admin/notifications/log/${randomUUID()}/resend`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin session', async () => {
      const res = await api()
        .post(`/v1/admin/notifications/log/${randomUUID()}/resend`)
        .set('Cookie', customerCookie);
      expect(res.status).toBe(403);
    });

    it('refuses to resend an auth flow — single-use credential (400)', async () => {
      const recipient = `auth-resend-${randomUUID()}${TEST_SUFFIX}`;
      const authTpl = await prisma.notificationTemplate.findUnique({
        where: { code: 'auth.password-reset' },
      });
      const original = await prisma.notificationLog.create({
        data: {
          templateId: authTpl?.id ?? null,
          templateCode: 'auth.password-reset',
          channel: 'email',
          recipient,
          status: 'sent',
          metadata: { locale: 'en', variables: { actionUrl: '[redacted]' } },
        },
      });

      const res = await api()
        .post(`/v1/admin/notifications/log/${original.id}/resend`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(400);

      // Nothing was enqueued — no new audit row beyond the seeded original.
      const rows = await prisma.notificationLog.findMany({ where: { recipient } });
      expect(rows).toHaveLength(1);
    });
  });

  // ── NE3 seeded / backfilled template bodies ────────────────────────────────
  // The e2e global setup reseeds then runs the idempotent backfill, so every
  // flow's body is the real, body-only token block from TEMPLATE_DEFAULTS — the
  // DB-as-truth source the renderer now prefers. These specs prove the
  // seed → backfill → DB wiring end-to-end against the real test database.
  describe('NE3 seeded template bodies', () => {
    it('every flow has non-empty fr + en bodies after backfill', async () => {
      const rows = await prisma.notificationTemplate.findMany({
        select: { code: true, body: true },
      });
      expect(rows.length).toBeGreaterThanOrEqual(14);
      for (const row of rows) {
        const body = (row.body ?? {}) as { fr?: string; en?: string };
        expect((body.fr ?? '').trim().length).toBeGreaterThan(0);
        expect((body.en ?? '').trim().length).toBeGreaterThan(0);
      }
    });

    it('order.placed body is a body-only token block (no chrome, carries {{orderNumber}})', async () => {
      const tpl = await prisma.notificationTemplate.findUnique({
        where: { code: 'order.placed' },
      });
      const body = (tpl?.body ?? {}) as { fr?: string; en?: string };
      expect(body.fr).toContain('{{orderNumber}}');
      expect(body.en).toContain('{{orderNumber}}');
      // body-only: the brand layout wraps it at render time, it is not stored.
      expect(body.en).not.toContain('<!doctype');
      expect(body.en).not.toContain('<html');
    });

    it('contact-form body preserves its table layout in both locales', async () => {
      const tpl = await prisma.notificationTemplate.findUnique({
        where: { code: 'contact-form' },
      });
      const body = (tpl?.body ?? {}) as { fr?: string; en?: string };
      for (const html of [body.fr, body.en]) {
        expect(html).toContain('<table');
        expect(html).toContain('{{message}}');
      }
    });
  });

  // ── NE5: net-new HTTP surfaces ──────────────────────────────────────────────
  //
  // The event-driven NE5 flows (returns / reviews / cart / staff-invite /
  // password-changed) are proven at the unit level (every resolver + skip path)
  // and ride the same dispatch → NotificationLog pipeline the NE1 gate specs
  // already exercise end-to-end. These cases cover the two genuinely-new HTTP
  // surfaces: the public contact endpoint and the de-stubbed gift-card resend.
  describe('NE5 contact + gift-card resend', () => {
    it('POST /v1/contact accepts a submission and writes a contact-form log', async () => {
      const before = await prisma.notificationLog.count({
        where: { templateCode: 'contact-form' },
      });

      const res = await api()
        .post('/v1/contact')
        .send({
          fromName: 'Sam Shopper',
          fromEmail: `contact-${randomUUID()}${TEST_SUFFIX}`,
          subjectLine: 'Order question',
          message: 'Where is my order?',
        });
      expect(res.status).toBe(202);

      let after = before;
      for (let i = 0; i < 40; i++) {
        after = await prisma.notificationLog.count({ where: { templateCode: 'contact-form' } });
        if (after > before) break;
        await sleep(150);
      }
      expect(after).toBeGreaterThan(before);
    });

    it('POST /v1/contact rejects an invalid submission (400)', async () => {
      const res = await api()
        .post('/v1/contact')
        .send({ fromName: '', fromEmail: 'not-an-email', subjectLine: '', message: '' });
      expect(res.status).toBe(400);
    });

    it('admin gift-card resend re-enqueues a genuine send (no longer a stub)', async () => {
      const recipient = `gc-resend-${randomUUID()}${TEST_SUFFIX}`;
      const tpl = await prisma.notificationTemplate.findUnique({
        where: { code: 'giftcard.purchase' },
      });
      await api()
        .patch(`/v1/admin/notifications/templates/${tpl!.id}`)
        .set('Cookie', adminCookie)
        .send({ sendEnabled: true });

      // Admin-issue a card with a recipient on file (store-credit grant).
      const issued = await api()
        .post('/v1/admin/gift-cards')
        .set('Cookie', adminCookie)
        .send({ initialBalance: 25, currency: STORE_CURRENCY, recipientEmail: recipient });
      expect(issued.status).toBe(201);
      const cardId = (issued.body?.data?.id ?? issued.body?.id) as string;

      const res = await api()
        .post(`/v1/admin/gift-cards/${cardId}/resend`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body?.data?.status ?? res.body?.status).toBe('queued');
      expect(res.body?.data?.recipientEmail ?? res.body?.recipientEmail).toBe(recipient);
    });
  });

  // ── NE6: admin "Notifications & Email" backend surface ──────────────────────
  // Preview (server-side draft render, both locales), send-test (to the caller's
  // own inbox), the pauseAll global switch wired through the generic settings
  // endpoint, and the template-CRUD read surface the admin matrix depends on.
  // The pauseAll → enqueue-gate skip is unit-covered (mail.service.spec NE1) and
  // propagates on a 30s TTL (no event invalidation), so it is not asserted live
  // here — only the settings round-trip that drives the same StoreSetting row.
  describe('NE6 settings + editor backend', () => {
    async function templateId(code: string): Promise<string> {
      const tpl = await prisma.notificationTemplate.findUnique({ where: { code } });
      return tpl!.id;
    }

    it('preview renders the DRAFT for every locale the store ships, without persisting', async () => {
      const id = await templateId('order.shipped');
      const before = await prisma.notificationTemplate.findUnique({ where: { id } });
      // Only the store's two enabled locales can be submitted (IsEnabledLocale,
      // plan E1.3.4); the fixture's default + secondary cover exactly that pair.
      const res = await api()
        .post(`/v1/admin/notifications/templates/${id}/preview`)
        .set('Cookie', adminCookie)
        .send({
          subject: {
            [STORE_DEFAULT_LOCALE]: 'Draft-default {{orderNumber}}',
            [STORE_SECONDARY_LOCALE]: 'Draft-secondary {{orderNumber}}',
          },
          body: {
            [STORE_DEFAULT_LOCALE]: '<p>Hello-default {{customerName}}</p>',
            [STORE_SECONDARY_LOCALE]: '<p>Hello-secondary {{customerName}}</p>',
          },
          variables: ['orderNumber', 'customerName'],
          sampleVariables: { orderNumber: 'ORD-77', customerName: 'Sara' },
        });
      expect(res.status).toBe(200);
      const data = res.body.data ?? res.body;
      // One entry per locale the store has enabled.
      expect(Object.keys(data).sort()).toEqual(
        [...STORE_CONFIG.localization.supportedLocales].sort(),
      );
      expect(data[STORE_DEFAULT_LOCALE].subject).toContain('Draft-default ORD-77');
      expect(data[STORE_DEFAULT_LOCALE].html).toContain('Hello-default Sara');
      expect(data[STORE_DEFAULT_LOCALE].html).toContain('<!doctype html>');
      expect(data[STORE_SECONDARY_LOCALE].subject).toContain('Draft-secondary ORD-77');
      expect(data[STORE_SECONDARY_LOCALE].html).toContain('Hello-secondary Sara');
      // The layout stamps the locale + direction it rendered, per the store's rtlLocales.
      const dirOf = (locale: string) =>
        STORE_CONFIG.localization.rtlLocales.includes(locale) ? 'rtl' : 'ltr';
      expect(data[STORE_DEFAULT_LOCALE].html).toContain(`lang="${STORE_DEFAULT_LOCALE}"`);
      expect(data[STORE_DEFAULT_LOCALE].html).toContain(`dir="${dirOf(STORE_DEFAULT_LOCALE)}"`);
      expect(data[STORE_SECONDARY_LOCALE].html).toContain(`lang="${STORE_SECONDARY_LOCALE}"`);
      expect(data[STORE_SECONDARY_LOCALE].html).toContain(`dir="${dirOf(STORE_SECONDARY_LOCALE)}"`);
      const after = await prisma.notificationTemplate.findUnique({ where: { id } });
      expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
    });

    it('preview rejects an undeclared {{token}} with UNKNOWN_TEMPLATE_TOKEN (400)', async () => {
      const id = await templateId('order.shipped');
      const res = await api()
        .post(`/v1/admin/notifications/templates/${id}/preview`)
        .set('Cookie', adminCookie)
        .send({
          body: { [STORE_DEFAULT_LOCALE]: 'x', [STORE_SECONDARY_LOCALE]: 'Hi {{ghost}}' },
          variables: [],
        });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('UNKNOWN_TEMPLATE_TOKEN');
    });

    it('preview rejects a locale key the store does not ship (400 VALIDATION_ERROR)', async () => {
      const id = await templateId('order.shipped');
      const res = await api()
        .post(`/v1/admin/notifications/templates/${id}/preview`)
        .set('Cookie', adminCookie)
        .send({
          body: {
            [STORE_DEFAULT_LOCALE]: 'x',
            [STORE_SECONDARY_LOCALE]: 'x',
            [DISABLED_LOCALE]: 'x',
          },
          variables: [],
        });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('preview is 404 on an unknown id and 403 for a customer', async () => {
      const id = await templateId('order.shipped');
      const body = { [STORE_DEFAULT_LOCALE]: 'x', [STORE_SECONDARY_LOCALE]: 'x' };
      const notFound = await api()
        .post(`/v1/admin/notifications/templates/${randomUUID()}/preview`)
        .set('Cookie', adminCookie)
        .send({ body });
      expect(notFound.status).toBe(404);
      const forbidden = await api()
        .post(`/v1/admin/notifications/templates/${id}/preview`)
        .set('Cookie', customerCookie)
        .send({ body });
      expect(forbidden.status).toBe(403);
    });

    it('send-test enqueues to the caller email + reports the honest outcome', async () => {
      const id = await templateId('order.shipped'); // order.* is locked → always sends
      for (const locale of [STORE_DEFAULT_LOCALE, STORE_SECONDARY_LOCALE]) {
        const res = await api()
          .post(`/v1/admin/notifications/templates/${id}/send-test`)
          .set('Cookie', adminCookie)
          .send({ locale });
        expect(res.status).toBe(200);
        const data = res.body.data ?? res.body;
        expect(data.recipient).toBe(ADMIN.email);
        expect(['queued', 'suppressed', 'skipped']).toContain(data.status);
      }
    });

    it('send-test enqueues in the requested locale (audit row records it)', async () => {
      const id = await templateId('order.shipped');
      const res = await api()
        .post(`/v1/admin/notifications/templates/${id}/send-test`)
        .set('Cookie', adminCookie)
        .send({ locale: STORE_SECONDARY_LOCALE });
      expect(res.status).toBe(200);
      const logId = (res.body.data ?? res.body).logId as string;
      const row = await prisma.notificationLog.findUnique({ where: { id: logId } });
      expect((row!.metadata as Record<string, unknown>).locale).toBe(STORE_SECONDARY_LOCALE);
    });

    it('send-test rejects a locale outside the store set (400 VALIDATION_ERROR)', async () => {
      const id = await templateId('order.shipped');
      const res = await api()
        .post(`/v1/admin/notifications/templates/${id}/send-test`)
        .set('Cookie', adminCookie)
        .send({ locale: DISABLED_LOCALE });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('send-test is 401 unauth, 403 for a customer, 404 on an unknown id', async () => {
      const id = await templateId('order.shipped');
      expect(
        (await api().post(`/v1/admin/notifications/templates/${id}/send-test`).send({})).status,
      ).toBe(401);
      expect(
        (
          await api()
            .post(`/v1/admin/notifications/templates/${id}/send-test`)
            .set('Cookie', customerCookie)
            .send({})
        ).status,
      ).toBe(403);
      expect(
        (
          await api()
            .post(`/v1/admin/notifications/templates/${randomUUID()}/send-test`)
            .set('Cookie', adminCookie)
            .send({})
        ).status,
      ).toBe(404);
    });

    it('PATCH /v1/admin/settings { pauseAll } round-trips through the notifications group', async () => {
      const set = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ pauseAll: true });
      expect(set.status).toBe(200);
      const get = await api().get('/v1/admin/settings').set('Cookie', adminCookie);
      expect(get.status).toBe(200);
      const settings = get.body.data ?? get.body;
      expect(settings.notifications.pauseAll).toBe(true);
      // reset to the default so the gate baseline is restored for other suites.
      await api().patch('/v1/admin/settings').set('Cookie', adminCookie).send({ pauseAll: false });
    });

    it('settings PATCH is 403 for a customer', async () => {
      const res = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', customerCookie)
        .send({ pauseAll: true });
      expect(res.status).toBe(403);
    });

    it('GET /templates lists with pagination meta (200); 401 unauth; 403 customer', async () => {
      const ok = await api().get('/v1/admin/notifications/templates').set('Cookie', adminCookie);
      expect(ok.status).toBe(200);
      expect(ok.body.meta).toHaveProperty('total');
      expect(Array.isArray(ok.body.data)).toBe(true);
      expect((await api().get('/v1/admin/notifications/templates')).status).toBe(401);
      expect(
        (await api().get('/v1/admin/notifications/templates').set('Cookie', customerCookie)).status,
      ).toBe(403);
    });

    it('GET /templates/:id returns the row (200) and 404 on an unknown id', async () => {
      const id = await templateId('order.shipped');
      const ok = await api()
        .get(`/v1/admin/notifications/templates/${id}`)
        .set('Cookie', adminCookie);
      expect(ok.status).toBe(200);
      const notFound = await api()
        .get(`/v1/admin/notifications/templates/${randomUUID()}`)
        .set('Cookie', adminCookie);
      expect(notFound.status).toBe(404);
    });

    // Sibling-site coverage for the translatable-DTO whitelist fix: the editor
    // SAVE path (create + update with the store's two enabled-locale bodies)
    // must survive the forbidNonWhitelisted ValidationPipe. Before the fix
    // every localized body 400ed because the DTO declared no locale
    // properties at all.
    it('create + update accept the store enabled-locale translatable bodies through the validation pipe', async () => {
      const code = `ne6.tmp.${randomUUID().slice(0, 8)}`;
      const created = await api()
        .post('/v1/admin/notifications/templates')
        .set('Cookie', adminCookie)
        .send({
          code,
          channel: 'email',
          event: 'ne6.tmp',
          subject: {
            default: 'S',
            [STORE_DEFAULT_LOCALE]: 'Subject default',
            [STORE_SECONDARY_LOCALE]: 'Subject secondary',
          },
          body: {
            default: 'B',
            [STORE_DEFAULT_LOCALE]: '<p>Hello default</p>',
            [STORE_SECONDARY_LOCALE]: '<p>Hello secondary</p>',
          },
          variables: [],
        });
      expect(created.status).toBe(201);
      const id = (created.body?.data?.id ?? created.body?.id) as string;

      const patched = await api()
        .patch(`/v1/admin/notifications/templates/${id}`)
        .set('Cookie', adminCookie)
        .send({
          body: {
            default: 'B2',
            [STORE_DEFAULT_LOCALE]: '<p>Edited default</p>',
            [STORE_SECONDARY_LOCALE]: '<p>Edited secondary</p>',
          },
        });
      expect(patched.status).toBe(200);

      await api().delete(`/v1/admin/notifications/templates/${id}`).set('Cookie', adminCookie);
    });

    // The other half of the same guard, and the reason the DTO enumerates its
    // locales instead of leaning on the index signature: a locale the renderer
    // has no copy for must not be storable. Without this the DTO could drift
    // back to an open shape and nothing would notice.
    it('create + update reject a locale key the store does not ship (400)', async () => {
      const code = `ne6.tmp.${randomUUID().slice(0, 8)}`;
      const created = await api()
        .post('/v1/admin/notifications/templates')
        .set('Cookie', adminCookie)
        .send({
          code,
          channel: 'email',
          event: 'ne6.tmp',
          body: {
            default: 'B',
            [STORE_DEFAULT_LOCALE]: '<p>Hello default</p>',
            [STORE_SECONDARY_LOCALE]: '<p>Hello secondary</p>',
            [DISABLED_LOCALE]: '<p>not shipped</p>',
          },
          variables: [],
        });
      expect(created.status).toBe(400);
      expect(created.body?.error?.code).toBe('VALIDATION_ERROR');
      // Nothing was persisted behind the rejection.
      expect(await prisma.notificationTemplate.findUnique({ where: { code } })).toBeNull();

      // Same guard on the edit path, against a throwaway row so a regression
      // here cannot corrupt a seeded flow for the rest of the run.
      const okCode = `ne6.tmp.${randomUUID().slice(0, 8)}`;
      const ok = await api()
        .post('/v1/admin/notifications/templates')
        .set('Cookie', adminCookie)
        .send({
          code: okCode,
          channel: 'email',
          event: 'ne6.tmp',
          subject: {
            default: 'S',
            [STORE_DEFAULT_LOCALE]: 'Subject default',
            [STORE_SECONDARY_LOCALE]: 'Subject secondary',
          },
          body: {
            default: 'B',
            [STORE_DEFAULT_LOCALE]: '<p>Hello default</p>',
            [STORE_SECONDARY_LOCALE]: '<p>Hello secondary</p>',
          },
          variables: [],
        });
      expect(ok.status).toBe(201);
      const okId = (ok.body?.data?.id ?? ok.body?.id) as string;

      const patched = await api()
        .patch(`/v1/admin/notifications/templates/${okId}`)
        .set('Cookie', adminCookie)
        .send({
          body: {
            default: 'B2',
            [STORE_DEFAULT_LOCALE]: 'x',
            [STORE_SECONDARY_LOCALE]: 'x',
            [DISABLED_LOCALE]: 'x',
          },
        });
      expect(patched.status).toBe(400);
      expect(patched.body?.error?.code).toBe('VALIDATION_ERROR');

      const unchanged = await prisma.notificationTemplate.findUnique({ where: { id: okId } });
      expect((unchanged!.body as Record<string, unknown>).default).toBe('B');

      await api().delete(`/v1/admin/notifications/templates/${okId}`).set('Cookie', adminCookie);
    });
  });

  // ── GET /v1/admin/notifications/log ─────────────────────────────────────────
  //
  // The audit list every other spec in this file writes rows into, and the only
  // read surface an operator has on outbound mail. It had no e2e coverage: the
  // resend route below it was tested, the list that feeds it was not.

  describe('GET /v1/admin/notifications/log', () => {
    it('returns 200 with the { data, meta } envelope', async () => {
      const res = await api().get('/v1/admin/notifications/log').set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20 });
      expect(typeof res.body.meta.total).toBe('number');
    });

    it('filters by recipient and honours pagination', async () => {
      const recipient = `log-list-${randomUUID()}${TEST_SUFFIX}`;
      await prisma.notificationLog.create({
        data: {
          templateCode: 'giftcard.purchase',
          channel: 'email',
          recipient,
          status: 'sent',
          metadata: { locale: 'fr' },
        },
      });

      const res = await api()
        .get(`/v1/admin/notifications/log?recipient=${encodeURIComponent(recipient)}&pageSize=5`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.meta.pageSize).toBe(5);
      const rows = res.body.data as Array<{ recipient: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient).toBe(recipient);
    });

    it('is 401 without a session', async () => {
      expect((await api().get('/v1/admin/notifications/log')).status).toBe(401);
    });

    it('is 403 for a session without notifications:view', async () => {
      const res = await api().get('/v1/admin/notifications/log').set('Cookie', customerCookie);
      expect(res.status).toBe(403);
    });
  });

  // ── NE7 — consent gate + preference center + one-click unsubscribe ──────────
  describe('NE7 consent gate + preference center', () => {
    const customerEmail = `customer${TEST_SUFFIX}`;

    async function customerId(): Promise<string> {
      const u = await prisma.user.findUnique({
        where: { email: customerEmail },
        select: { id: true },
      });
      if (!u) throw new Error('customer not found');
      return u.id;
    }

    // Seed a historical cart.abandoned (LIFECYCLE) log so the admin resend path
    // re-dispatches it through MailService.enqueue → the NE7 consent gate. This
    // is the only HTTP-drivable way to exercise the gate (cart.abandoned itself
    // fires from a cron producer, not a request).
    async function seedLifecycleLog(): Promise<string> {
      const row = await prisma.notificationLog.create({
        data: {
          templateCode: 'cart.abandoned',
          channel: 'email',
          recipient: customerEmail,
          status: 'sent',
          metadata: {
            locale: 'fr',
            variables: {
              itemCount: 1,
              subtotal: '10',
              currency: STORE_CURRENCY,
              cartUrl: 'https://x.test/cart',
            },
          },
        },
      });
      return row.id;
    }

    afterEach(async () => {
      // Reset consent between cases so each starts from opt-out.
      await prisma.notificationPreference.deleteMany({
        where: { user: { email: customerEmail } },
      });
    });

    describe('GET/PATCH /v1/users/me/notification-preferences', () => {
      it('returns an all-off map by default (opt-in required)', async () => {
        const res = await api()
          .get('/v1/users/me/notification-preferences')
          .set('Cookie', customerCookie);
        expect(res.status).toBe(200);
        expect(res.body.data.LIFECYCLE).toEqual({ email: false, sms: false, push: false });
        expect(res.body.data.MARKETING).toEqual({ email: false, sms: false, push: false });
      });

      it('rejects an unauthenticated read with 401 + stable code', async () => {
        const res = await api().get('/v1/users/me/notification-preferences');
        expect(res.status).toBe(401);
        expect(res.body.error?.code).toBe('AUTH_UNAUTHENTICATED');
      });

      it('rejects an unauthenticated write with 401 + stable code', async () => {
        const res = await api()
          .patch('/v1/users/me/notification-preferences')
          .send({ LIFECYCLE: { email: true } });
        expect(res.status).toBe(401);
        expect(res.body.error?.code).toBe('AUTH_UNAUTHENTICATED');
      });

      it('round-trips a consent opt-in', async () => {
        const patched = await api()
          .patch('/v1/users/me/notification-preferences')
          .set('Cookie', customerCookie)
          .send({ LIFECYCLE: { email: true } });
        expect(patched.status).toBe(200);
        expect(patched.body.data.LIFECYCLE.email).toBe(true);

        const reread = await api()
          .get('/v1/users/me/notification-preferences')
          .set('Cookie', customerCookie);
        expect(reread.body.data.LIFECYCLE.email).toBe(true);
      });

      it('rejects an unknown category (whitelist)', async () => {
        const res = await api()
          .patch('/v1/users/me/notification-preferences')
          .set('Cookie', customerCookie)
          .send({ PROMOS: { email: true } });
        expect(res.status).toBe(400);
      });
    });

    describe('consent gate (via admin resend of a LIFECYCLE log)', () => {
      it('skips a LIFECYCLE send when the recipient has not consented', async () => {
        const logId = await seedLifecycleLog();
        const res = await api()
          .post(`/v1/admin/notifications/log/${logId}/resend`)
          .set('Cookie', adminCookie);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('skipped');

        const skipped = await prisma.notificationLog.findFirst({
          where: { recipient: customerEmail, templateCode: 'cart.abandoned', status: 'skipped' },
          orderBy: { sentAt: 'desc' },
          select: { metadata: true },
        });
        expect((skipped?.metadata as Record<string, unknown>)?.reason).toBe('no-consent');
      });

      it('queues a LIFECYCLE send once the recipient opts in', async () => {
        await api()
          .patch('/v1/users/me/notification-preferences')
          .set('Cookie', customerCookie)
          .send({ LIFECYCLE: { email: true } });

        const logId = await seedLifecycleLog();
        const res = await api()
          .post(`/v1/admin/notifications/log/${logId}/resend`)
          .set('Cookie', adminCookie);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('queued');
      });
    });

    describe('public one-click unsubscribe (RFC 8058)', () => {
      it('opts the user out for a valid token + reflects it in the preference map', async () => {
        // Opt in first so the unsubscribe has something to flip.
        await api()
          .patch('/v1/users/me/notification-preferences')
          .set('Cookie', customerCookie)
          .send({ MARKETING: { email: true } });

        const token = signUnsubscribeToken(await customerId(), 'MARKETING', E2E_BETTER_AUTH_SECRET);
        const res = await api().post(`/v1/unsubscribe?token=${encodeURIComponent(token)}`);
        expect(res.status).toBe(200);
        expect(res.body.data.unsubscribed).toBe(true);

        const reread = await api()
          .get('/v1/users/me/notification-preferences')
          .set('Cookie', customerCookie);
        expect(reread.body.data.MARKETING.email).toBe(false);
      });

      it('rejects a tampered token with 400 + stable code and changes nothing', async () => {
        const res = await api().post('/v1/unsubscribe?token=not-a-real-token');
        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('INVALID_UNSUBSCRIBE_TOKEN');
      });

      it('GET redirects to the storefront preference center under the store default locale', async () => {
        const token = signUnsubscribeToken(await customerId(), 'LIFECYCLE', E2E_BETTER_AUTH_SECRET);
        const res = await api().get(`/v1/unsubscribe?token=${encodeURIComponent(token)}`);
        expect(res.status).toBe(302);
        // The storefront is locale-prefixed; an absent locale resolves to the store default.
        expect(res.headers.location).toContain(
          `/${STORE_DEFAULT_LOCALE}/account/preferences?unsubscribed=LIFECYCLE`,
        );
      });

      it('GET honours the locale that rode on the emailed link', async () => {
        const token = signUnsubscribeToken(await customerId(), 'MARKETING', E2E_BETTER_AUTH_SECRET);
        const res = await api().get(`/v1/unsubscribe?token=${encodeURIComponent(token)}&locale=en`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('/en/account/preferences?unsubscribed=MARKETING');
      });

      it('GET resolves a locale the storefront does not route to the store default', async () => {
        // A link still in an inbox can carry a locale the store no longer
        // enables. It must land on the default page, not on a 404 segment.
        const token = signUnsubscribeToken(await customerId(), 'LIFECYCLE', E2E_BETTER_AUTH_SECRET);
        const res = await api().get(
          `/v1/unsubscribe?token=${encodeURIComponent(token)}&locale=${DISABLED_LOCALE}`,
        );
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain(
          `/${STORE_DEFAULT_LOCALE}/account/preferences?unsubscribed=LIFECYCLE`,
        );
      });

      it('GET with a tampered token redirects to the invalid state', async () => {
        const res = await api().get(
          `/v1/unsubscribe?token=not-a-real-token&locale=${STORE_SECONDARY_LOCALE}`,
        );
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain(
          `/${STORE_SECONDARY_LOCALE}/account/preferences?unsubscribed=invalid`,
        );
      });
    });
  });

  // ── NE8 — back-in-stock fan-out (restock → consenting wishlister) ───────────
  // The one NE8 path with an HTTP trigger in this out-of-process harness: an
  // admin stock adjustment that crosses 0→positive emits inventory.restocked,
  // the back-in-stock listener fans out to wishlisters, and the LIFECYCLE consent
  // gate delivers only to those who opted in. The scheduled/delayed producers
  // (review-request, gift-card expiry, staff digests) have no HTTP trigger and
  // are covered at the unit level.
  describe('NE8 back-in-stock fan-out', () => {
    const SLUG = 'e2e-ne8-bis-product';
    const SKU = 'E2E-NE8-BIS-SKU';
    const LOC_CODE = 'E2E-NE8-BIS-LOC';
    const TYPE_CODE = 'e2e-ne8-bis-type';
    let variantId: string;
    let locationId: string;
    let productId: string;
    let customerUserId: string;
    const customerEmail = `customer${TEST_SUFFIX}`;

    async function cleanupNe8(): Promise<void> {
      await prisma.notificationLog.deleteMany({
        where: { templateCode: 'product.back-in-stock', recipient: { contains: TEST_SUFFIX } },
      });
      await prisma.wishlistItem.deleteMany({ where: { product: { slug: SLUG } } });
      await prisma.notificationPreference.deleteMany({
        where: { user: { email: { contains: TEST_SUFFIX } }, category: 'LIFECYCLE' },
      });
      await prisma.inventoryMovement.deleteMany({ where: { location: { code: LOC_CODE } } });
      await prisma.stockLevel.deleteMany({ where: { location: { code: LOC_CODE } } });
      await prisma.inventoryLocation.deleteMany({ where: { code: LOC_CODE } });
      await prisma.productVariant.deleteMany({ where: { sku: SKU } });
      await prisma.product.deleteMany({ where: { slug: SLUG } });
      await prisma.productType.deleteMany({ where: { code: TYPE_CODE } });
    }

    beforeAll(async () => {
      await cleanupNe8();
      const customer = await prisma.user.findUnique({
        where: { email: customerEmail },
        select: { id: true },
      });
      customerUserId = customer!.id;

      const productType = await prisma.productType.create({
        data: { name: { default: 'NE8', fr: 'NE8', en: 'NE8' }, code: TYPE_CODE },
      });
      const product = await prisma.product.create({
        data: {
          name: {
            default: 'NE8 Back-in-stock',
            fr: 'NE8 De nouveau en stock',
            en: 'NE8 Back-in-stock',
          },
          slug: SLUG,
          productTypeId: productType.id,
        },
      });
      productId = product.id;
      const variant = await prisma.productVariant.create({
        data: { productId, sku: SKU, price: 12.5 },
      });
      variantId = variant.id;
      const location = await prisma.inventoryLocation.create({
        data: { name: 'NE8 BIS Loc', code: LOC_CODE, isActive: true },
      });
      locationId = location.id;
      // Start at zero so the adjustment below is a genuine 0→positive crossing.
      await prisma.stockLevel.create({ data: { variantId, locationId, onHand: 0, reserved: 0 } });

      // The customer wishlisted the product AND opted into lifecycle email.
      await prisma.wishlistItem.create({ data: { userId: customerUserId, productId } });
      await prisma.notificationPreference.upsert({
        where: { userId_category: { userId: customerUserId, category: 'LIFECYCLE' } },
        update: { email: true },
        create: { userId: customerUserId, category: 'LIFECYCLE', email: true },
      });
    });

    afterAll(cleanupNe8);

    it('a 0→positive stock adjustment notifies a consenting wishlister', async () => {
      const res = await api()
        .patch('/v1/admin/inventory/adjust')
        .set('Cookie', adminCookie)
        .set('X-Idempotency-Key', randomUUID())
        .send({ variantId, locationId, quantity: 5, reason: 'RECEIVED' });
      expect(res.status).toBe(200);

      // Async: adjust → inventory.restocked → listener → enqueue → NotificationLog.
      let log = await prisma.notificationLog.findFirst({
        where: { recipient: customerEmail, templateCode: 'product.back-in-stock' },
      });
      for (let i = 0; i < 40 && !log; i++) {
        await sleep(150);
        log = await prisma.notificationLog.findFirst({
          where: { recipient: customerEmail, templateCode: 'product.back-in-stock' },
        });
      }
      expect(log).not.toBeNull();
      expect(['queued', 'sent']).toContain(log!.status);
    });
  });
});
