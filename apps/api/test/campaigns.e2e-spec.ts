import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
  signUpCustomer,
  ADMIN,
  DISABLED_LOCALE,
  STORE_CONFIG,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';

const SUFFIX = '@e2e-campaigns.test';
const PASSWORD = 'StrongPass1!';
const COUPON = 'E2ECAMP15';

/** Staff who may run a campaign but is not the seeded SUPER_ADMIN bypass. */
const MANAGER_EMAIL = `manager${SUFFIX}`;
/** Staff with a campaigns permission that is NOT `campaigns:manage`. */
const VIEWER_EMAIL = `viewer${SUFFIX}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bodyId = (res: { body: { data?: { id?: string }; id?: string } }): string =>
  (res.body.data?.id ?? res.body.id) as string;

describe('Campaigns (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let customerCookie: string;
  let managerCookie: string;
  let managerUserId: string;
  let viewerCookie: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    // A crashed prior run leaves these rows behind, and every create below is
    // unique-constrained on email — clean first so the suite is repeatable.
    await prisma.subscriber.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.promotion.deleteMany({ where: { couponCode: COUPON } });

    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    customerCookie = await signUpCustomer(prisma, `cust${SUFFIX}`, PASSWORD, {
      firstName: 'Camp',
      lastName: 'Cust',
    });

    // Two staff sessions so the send-test RBAC is proven against the permission
    // itself, not against the SUPER_ADMIN bypass or a plain customer role.
    const manager = await createUserWithRole(prisma, {
      email: MANAGER_EMAIL,
      password: PASSWORD,
      role: 'MANAGER',
      permissions: ['campaigns:view', 'campaigns:manage'],
      firstName: 'Camp',
      lastName: 'Manager',
    });
    managerUserId = manager.userId;
    managerCookie = await loginAs(MANAGER_EMAIL, PASSWORD);

    await createUserWithRole(prisma, {
      email: VIEWER_EMAIL,
      password: PASSWORD,
      role: 'MANAGER',
      permissions: ['campaigns:view'],
      firstName: 'Camp',
      lastName: 'Viewer',
    });
    viewerCookie = await loginAs(VIEWER_EMAIL, PASSWORD);

    await prisma.promotion.create({
      data: {
        name: { fr: 'Coupon E2E', en: 'E2E coupon' },
        type: 'PERCENTAGE',
        applicationMethod: 'COUPON',
        value: 15,
        couponCode: COUPON,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.campaignSend.deleteMany({ where: { recipient: { contains: SUFFIX } } });
    await prisma.campaign.deleteMany({ where: { name: { contains: 'E2E' } } });
    await prisma.subscriber.deleteMany({ where: { email: { contains: SUFFIX } } });
    await prisma.promotion.deleteMany({ where: { couponCode: COUPON } });
    // The no-recipient case blanks the manager's email, so clean by id too —
    // a `contains: SUFFIX` filter would no longer match a restore that failed.
    await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } });
    // Guarded: an undefined id would widen the filter to every user.
    if (managerUserId) await prisma.user.deleteMany({ where: { id: managerUserId } });
    await prisma.$disconnect();
  });

  describe('RBAC + CRUD', () => {
    let campaignId: string;

    it('POST /v1/admin/campaigns is 401 without auth', async () => {
      const res = await api().post('/v1/admin/campaigns').send({});
      expect(res.status).toBe(401);
    });

    it('POST /v1/admin/campaigns is 403 for a customer', async () => {
      const res = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', customerCookie)
        .send({ name: 'E2E x', subject: { en: 's' }, body: { en: 'b' }, segment: 'ALL_CONFIRMED' });
      expect(res.status).toBe(403);
    });

    it('creates a DRAFT campaign (201) for an admin', async () => {
      const res = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E broadcast',
          subject: { [STORE_DEFAULT_LOCALE]: 'Bonjour', [STORE_SECONDARY_LOCALE]: 'Hello' },
          body: { [STORE_DEFAULT_LOCALE]: 'Contenu', [STORE_SECONDARY_LOCALE]: 'Body' },
          segment: 'ALL_CONFIRMED',
        });
      expect(res.status).toBe(201);
      campaignId = bodyId(res);
      expect(campaignId).toBeTruthy();
    });

    // `CampaignTranslatableDto` declares `default`/`fr`/`en`/`ar` explicitly
    // rather than leaning on its index signature, precisely so the global
    // `forbidNonWhitelisted` pipe rejects a locale the store does not ship
    // (IsEnabledLocale, plan E1.3.4). Without this case the DTO could quietly
    // grow an index-signature-only shape again and admit an unrenderable locale.
    it('rejects a locale key the store does not ship (400 VALIDATION_ERROR)', async () => {
      const res = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E undeclared locale',
          subject: {
            [STORE_DEFAULT_LOCALE]: 'Bonjour',
            [STORE_SECONDARY_LOCALE]: 'Hello',
            [DISABLED_LOCALE]: 'not shipped',
          },
          body: { [STORE_DEFAULT_LOCALE]: 'Contenu', [STORE_SECONDARY_LOCALE]: 'Body' },
          segment: 'ALL_CONFIRMED',
        });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an invalid coupon with 400 CAMPAIGN_INVALID_COUPON', async () => {
      const res = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E bad',
          subject: { en: 's' },
          body: { en: 'b' },
          segment: 'ALL_CONFIRMED',
          couponCode: 'DOES_NOT_EXIST',
        });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('CAMPAIGN_INVALID_COUPON');
    });

    it('accepts a valid attached coupon', async () => {
      const res = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E coupon campaign',
          subject: { en: 's' },
          body: { en: 'Use {{couponCode}}' },
          segment: 'ALL_CONFIRMED',
          couponCode: COUPON,
        });
      expect(res.status).toBe(201);
    });

    it('GET list is 200 with pagination meta', async () => {
      const res = await api().get('/v1/admin/campaigns').set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.meta).toMatchObject({ page: 1 });
    });

    it('GET :id is 404 for an unknown campaign', async () => {
      const res = await api().get('/v1/admin/campaigns/nonexistent-id').set('Cookie', adminCookie);
      expect(res.status).toBe(404);
    });

    it('PATCH updates a draft campaign name', async () => {
      const res = await api()
        .patch(`/v1/admin/campaigns/${campaignId}`)
        .set('Cookie', adminCookie)
        .send({ name: 'E2E renamed' });
      expect(res.status).toBe(200);
    });

    it('GET :id/stats is 200', async () => {
      const res = await api()
        .get(`/v1/admin/campaigns/${campaignId}/stats`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(200);
    });

    it('DELETE soft-deletes the campaign (then 404 on read)', async () => {
      const del = await api()
        .delete(`/v1/admin/campaigns/${campaignId}`)
        .set('Cookie', adminCookie);
      expect(del.status).toBe(204);
      const after = await api().get(`/v1/admin/campaigns/${campaignId}`).set('Cookie', adminCookie);
      expect(after.status).toBe(404);
    });
  });

  describe('Subscribers admin', () => {
    it('GET /v1/admin/subscribers is 401 without auth, 200 for admin', async () => {
      expect((await api().get('/v1/admin/subscribers')).status).toBe(401);
      const res = await api().get('/v1/admin/subscribers').set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('meta');
    });

    it('PATCH /v1/admin/subscribers/:id toggles unsubscribed', async () => {
      const sub = await prisma.subscriber.create({
        data: { email: `manual${SUFFIX}`, locale: 'en', source: 'admin', confirmedAt: new Date() },
      });
      const res = await api()
        .patch(`/v1/admin/subscribers/${sub.id}`)
        .set('Cookie', adminCookie)
        .send({ unsubscribed: true });
      expect(res.status).toBe(200);
      const after = await prisma.subscriber.findUnique({ where: { id: sub.id } });
      expect(after?.unsubscribedAt).not.toBeNull();
    });
  });

  describe('End-to-end send on the isolated campaign plane', () => {
    it('sends a broadcast to a confirmed subscriber and records a CampaignSend', async () => {
      const email = `target${SUFFIX}`;
      await prisma.subscriber.create({
        data: { email, locale: 'en', source: 'import', confirmedAt: new Date() },
      });
      const create = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E send',
          subject: { [STORE_DEFAULT_LOCALE]: 'Promo', [STORE_SECONDARY_LOCALE]: 'Sale' },
          body: { [STORE_DEFAULT_LOCALE]: 'Achetez', [STORE_SECONDARY_LOCALE]: 'Shop now' },
          segment: 'ALL_CONFIRMED',
        });
      const id = bodyId(create);

      const send = await api()
        .post(`/v1/admin/campaigns/${id}/send`)
        .set('Cookie', adminCookie)
        .send({});
      expect(send.status).toBe(200);

      // The campaign queue worker processes the batch (dry-run send) — poll for it.
      let row = null;
      for (let i = 0; i < 20 && !row; i++) {
        await sleep(500);
        row = await prisma.campaignSend.findFirst({ where: { campaignId: id, recipient: email } });
      }
      expect(row).toBeTruthy();
      expect(row?.status).toBe('sent');
      expect(row?.providerMessageId).toBeTruthy();
    });

    it('is idempotent — a second POST /send 409s and does not re-enqueue', async () => {
      const create = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E idempotent',
          subject: { en: 's' },
          body: { en: 'b' },
          segment: 'ALL_CONFIRMED',
        });
      const id = bodyId(create);

      const first = await api()
        .post(`/v1/admin/campaigns/${id}/send`)
        .set('Cookie', adminCookie)
        .send({});
      expect(first.status).toBe(200);
      const second = await api()
        .post(`/v1/admin/campaigns/${id}/send`)
        .set('Cookie', adminCookie)
        .send({});
      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe('CAMPAIGN_NOT_SENDABLE');
    });
  });

  describe('Translatable locale resolution', () => {
    let id: string;

    beforeAll(async () => {
      const create = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E locale',
          subject: {
            [STORE_DEFAULT_LOCALE]: "Soldes d'hiver",
            [STORE_SECONDARY_LOCALE]: 'Winter Sale',
          },
          body: { [STORE_DEFAULT_LOCALE]: 'Achetez', [STORE_SECONDARY_LOCALE]: 'Shop' },
          segment: 'ALL_CONFIRMED',
        });
      id = bodyId(create);
    });

    it('the admin edit GET returns the raw store-locale Translatable (both locales for editing)', async () => {
      const res = await api()
        .get(`/v1/admin/campaigns/${id}`)
        .set('Cookie', adminCookie)
        .set('X-Resolve-Locale', 'false');
      expect(res.status).toBe(200);
      const subject = (res.body.data ?? res.body).subject;
      expect(subject).toMatchObject({
        [STORE_DEFAULT_LOCALE]: "Soldes d'hiver",
        [STORE_SECONDARY_LOCALE]: 'Winter Sale',
      });
    });

    it('preview renders exactly the locales the store ships (render-time i18n)', async () => {
      const res = await api()
        .post(`/v1/admin/campaigns/${id}/preview`)
        .set('Cookie', adminCookie)
        .send({});
      expect(res.status).toBe(200);
      const data = res.body.data ?? res.body;
      // One entry per locale the store has enabled.
      expect(Object.keys(data).sort()).toEqual(
        [...STORE_CONFIG.localization.supportedLocales].sort(),
      );
      expect(data[STORE_DEFAULT_LOCALE].subject).toBe("Soldes d'hiver");
      expect(data[STORE_SECONDARY_LOCALE].subject).toBe('Winter Sale');
      // The layout stamps the locale + direction it rendered, per rtlLocales.
      const dirOf = (locale: string) =>
        STORE_CONFIG.localization.rtlLocales.includes(locale) ? 'rtl' : 'ltr';
      expect(data[STORE_DEFAULT_LOCALE].html).toContain(`lang="${STORE_DEFAULT_LOCALE}"`);
      expect(data[STORE_SECONDARY_LOCALE].html).toContain(`lang="${STORE_SECONDARY_LOCALE}"`);
      expect(data[STORE_DEFAULT_LOCALE].html).toContain(`dir="${dirOf(STORE_DEFAULT_LOCALE)}"`);
    });
  });

  // ── POST /v1/admin/campaigns/:id/test ──────────────────────────────────────
  //
  // The operator's "send this to me first" button. It had no e2e coverage at
  // all: it renders through the genuine `renderDraft` + ResendClient seam (dry
  // run outside prod), so a broken render or a broken guard was invisible here.

  describe('POST /v1/admin/campaigns/:id/test', () => {
    let testCampaignId: string;

    beforeAll(async () => {
      const create = await api()
        .post('/v1/admin/campaigns')
        .set('Cookie', adminCookie)
        .send({
          name: 'E2E send-test',
          subject: {
            [STORE_DEFAULT_LOCALE]: 'Essai example.test',
            [STORE_SECONDARY_LOCALE]: 'example.test trial',
          },
          body: {
            [STORE_DEFAULT_LOCALE]: '<p>Bonjour</p>',
            [STORE_SECONDARY_LOCALE]: '<p>Hello</p>',
          },
          segment: 'ALL_CONFIRMED',
        });
      expect(create.status).toBe(201);
      testCampaignId = bodyId(create);
    });

    it('sends a test to the operator own inbox (200)', async () => {
      const res = await api()
        .post(`/v1/admin/campaigns/${testCampaignId}/test`)
        .set('Cookie', managerCookie)
        .send({ locale: STORE_SECONDARY_LOCALE });
      expect(res.status).toBe(200);
      const data = res.body.data ?? res.body;
      expect(data.status).toBe('sent');
      expect(data.recipient).toBe(MANAGER_EMAIL);
    });

    it('accepts the store other locale and defaults when none is given', async () => {
      const en = await api()
        .post(`/v1/admin/campaigns/${testCampaignId}/test`)
        .set('Cookie', managerCookie)
        .send({ locale: 'en' });
      expect(en.status).toBe(200);

      const omitted = await api()
        .post(`/v1/admin/campaigns/${testCampaignId}/test`)
        .set('Cookie', managerCookie)
        .send({});
      expect(omitted.status).toBe(200);
    });

    it('rejects a locale outside the store set (400 VALIDATION_ERROR)', async () => {
      const res = await api()
        .post(`/v1/admin/campaigns/${testCampaignId}/test`)
        .set('Cookie', managerCookie)
        .send({ locale: DISABLED_LOCALE });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('is 400 TEST_SEND_NO_RECIPIENT when the operator account has no email', async () => {
      // The guard exists because a staff row can legitimately reach the admin
      // with a blank email (SSO-provisioned, or an import). Blank it on the
      // live session, then restore — the session is keyed by id, not email.
      await prisma.user.update({ where: { id: managerUserId }, data: { email: '' } });
      try {
        const res = await api()
          .post(`/v1/admin/campaigns/${testCampaignId}/test`)
          .set('Cookie', managerCookie)
          .send({ locale: STORE_SECONDARY_LOCALE });
        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('TEST_SEND_NO_RECIPIENT');
      } finally {
        await prisma.user.update({ where: { id: managerUserId }, data: { email: MANAGER_EMAIL } });
      }
    });

    it('is 401 without a session', async () => {
      const res = await api().post(`/v1/admin/campaigns/${testCampaignId}/test`).send({});
      expect(res.status).toBe(401);
    });

    it('is 403 for a session without campaigns:manage', async () => {
      const viewer = await api()
        .post(`/v1/admin/campaigns/${testCampaignId}/test`)
        .set('Cookie', viewerCookie)
        .send({});
      expect(viewer.status).toBe(403);

      const customer = await api()
        .post(`/v1/admin/campaigns/${testCampaignId}/test`)
        .set('Cookie', customerCookie)
        .send({});
      expect(customer.status).toBe(403);
    });

    it('is 404 for an unknown campaign', async () => {
      const res = await api()
        .post(`/v1/admin/campaigns/${randomUUID()}/test`)
        .set('Cookie', managerCookie)
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
