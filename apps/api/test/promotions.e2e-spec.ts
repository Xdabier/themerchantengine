import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-promotions.test';
const TEST_PASSWORD = 'StrongPass1';

const CART = {
  subtotal: 200,
  items: [{ productId: 'e2e-prod-1', categoryId: 'e2e-cat-1', quantity: 2, unitPrice: 100 }],
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Promotions (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;

  let percentagePromoId: string;
  let fixedPromoId: string;
  let exclusiveAutoPromoId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Clean up previous runs ────────────────────────────────────────────────
    await prisma.promotionUsage.deleteMany({
      where: { promotion: { couponCode: { startsWith: 'E2E-' } } },
    });
    await prisma.promotionCategory.deleteMany({
      where: { promotion: { couponCode: { startsWith: 'E2E-' } } },
    });
    await prisma.promotionProduct.deleteMany({
      where: { promotion: { couponCode: { startsWith: 'E2E-' } } },
    });
    await prisma.promotion.deleteMany({
      where: { couponCode: { startsWith: 'E2E-' } },
    });
    await prisma.promotion.deleteMany({
      where: {
        applicationMethod: 'AUTOMATIC',
        name: { path: ['default'], string_starts_with: 'E2E-Auto' },
      },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E-Promo-' } } });

    // ── Create admin user with promotions permissions ─────────────────────────
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: [
        'promotions:view',
        'promotions:create',
        'promotions:update',
        'promotions:delete',
      ],
      firstName: 'Promo',
      lastName: 'Admin',
    });

    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);
  });

  afterAll(async () => {
    await prisma.promotionUsage.deleteMany({
      where: { promotion: { couponCode: { startsWith: 'E2E-' } } },
    });
    await prisma.promotionCategory.deleteMany({
      where: { promotion: { couponCode: { startsWith: 'E2E-' } } },
    });
    await prisma.promotionProduct.deleteMany({
      where: { promotion: { couponCode: { startsWith: 'E2E-' } } },
    });
    await prisma.promotion.deleteMany({
      where: { couponCode: { startsWith: 'E2E-' } },
    });
    await prisma.promotion.deleteMany({
      where: {
        applicationMethod: 'AUTOMATIC',
        name: { path: ['default'], string_starts_with: 'E2E-Auto' },
      },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E-Promo-' } } });
    await prisma.$disconnect();
  });

  // ── 1. Create promotions (admin) ───────────────────────────────────────────

  it('POST /v1/admin/promotions — creates PERCENTAGE coupon (201)', async () => {
    const res = await api()
      .post('/v1/admin/promotions')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E 20% Off', en: 'E2E 20% Off' },
        type: 'PERCENTAGE',
        applicationMethod: 'COUPON',
        couponCode: 'E2E-PCTOFF',
        value: 20,
        isActive: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    percentagePromoId = res.body.data.id as string;
  });

  it('POST /v1/admin/promotions — creates FIXED_AMOUNT coupon (201)', async () => {
    const res = await api()
      .post('/v1/admin/promotions')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E Fixed 50 Off' },
        type: 'FIXED_AMOUNT',
        applicationMethod: 'COUPON',
        couponCode: 'E2E-FIX50',
        value: 50,
        minimumOrderAmount: 100,
        isActive: true,
      });

    expect(res.status).toBe(201);
    fixedPromoId = res.body.data.id as string;
  });

  it('POST /v1/admin/promotions — creates exclusive AUTOMATIC promotion (201)', async () => {
    const res = await api()
      .post('/v1/admin/promotions')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E-Auto Exclusive 30%' },
        type: 'PERCENTAGE',
        applicationMethod: 'AUTOMATIC',
        value: 30,
        isExclusive: true,
        priority: 0,
        isActive: true,
      });

    expect(res.status).toBe(201);
    exclusiveAutoPromoId = res.body.data.id as string;
  });

  it('POST /v1/admin/promotions — creates non-exclusive AUTOMATIC promotion (201)', async () => {
    const res = await api()
      .post('/v1/admin/promotions')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E-Auto Normal 5%' },
        type: 'PERCENTAGE',
        applicationMethod: 'AUTOMATIC',
        value: 5,
        isExclusive: false,
        priority: 1,
        isActive: true,
      });

    expect(res.status).toBe(201);
  });

  // ── 2. List promotions (admin) ─────────────────────────────────────────────

  it('GET /v1/admin/promotions — returns paginated promotions (200)', async () => {
    const res = await api().get('/v1/admin/promotions').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(4);
  });

  it('GET /v1/admin/promotions?type=PERCENTAGE — filters by type', async () => {
    const res = await api().get('/v1/admin/promotions?type=PERCENTAGE').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const types = (res.body.data as Array<{ type: string }>).map((p) => p.type);
    expect(types.every((t) => t === 'PERCENTAGE')).toBe(true);
  });

  // ── 3. Validate coupon (storefront, public) ────────────────────────────────

  it('POST /v1/promotions/validate-coupon — valid PERCENTAGE coupon returns discount (200)', async () => {
    // An active exclusive AUTOMATIC promo blocks every coupon (§4.11 H-3), so
    // park it inactive while the coupon-validation tests run — the automatic
    // suite below re-activates it.
    await prisma.promotion.update({
      where: { id: exclusiveAutoPromoId },
      data: { isActive: false },
    });

    const res = await api()
      .post('/v1/promotions/validate-coupon')
      .send({ code: 'E2E-PCTOFF', ...CART });

    expect(res.status).toBe(200);
    expect(res.body.data.discountAmount).toBeCloseTo(40); // 200 × 20%
    expect(res.body.data.code).toBe('E2E-PCTOFF');
  });

  it('POST /v1/promotions/validate-coupon — valid FIXED_AMOUNT coupon returns discount (200)', async () => {
    const res = await api()
      .post('/v1/promotions/validate-coupon')
      .send({ code: 'E2E-FIX50', ...CART });

    expect(res.status).toBe(200);
    expect(res.body.data.discountAmount).toBeCloseTo(50);
  });

  it('POST /v1/promotions/validate-coupon — unknown code returns 400', async () => {
    const res = await api()
      .post('/v1/promotions/validate-coupon')
      .send({ code: 'DOES-NOT-EXIST', ...CART });

    expect(res.status).toBe(400);
  });

  it('POST /v1/promotions/validate-coupon — below minimumOrderAmount returns 400', async () => {
    const res = await api()
      .post('/v1/promotions/validate-coupon')
      .send({ code: 'E2E-FIX50', subtotal: 50, items: CART.items });

    expect(res.status).toBe(400);
  });

  it('POST /v1/promotions/validate-coupon — 400 on missing required fields', async () => {
    const res = await api().post('/v1/promotions/validate-coupon').send({ subtotal: 100 }); // missing code and items

    expect(res.status).toBe(400);
  });

  // ── 4. Automatic promotions (storefront, public) ───────────────────────────

  it('POST /v1/promotions/automatic — returns only exclusive promo when top-priority is exclusive', async () => {
    // Re-activate the exclusive promo parked by the coupon-validation tests.
    await prisma.promotion.update({
      where: { id: exclusiveAutoPromoId },
      data: { isActive: true },
    });

    const res = await api().post('/v1/promotions/automatic').send(CART);

    expect(res.status).toBe(200);
    const promos = res.body.data as Array<{ promotionId: string }>;
    // The exclusive promo at priority=0 should win
    expect(promos).toHaveLength(1);
    expect(promos[0].promotionId).toBe(exclusiveAutoPromoId);
  });

  // ── 5. Update a promotion (admin) ──────────────────────────────────────────

  it('PATCH /v1/admin/promotions/:id — updates value (200)', async () => {
    const res = await api()
      .patch(`/v1/admin/promotions/${percentagePromoId}`)
      .set('Cookie', adminCookie)
      .send({ value: 25 });

    expect(res.status).toBe(200);
    expect(Number(res.body.data.value)).toBeCloseTo(25);
  });

  it('PATCH /v1/admin/promotions/:id — 404 for unknown id', async () => {
    const res = await api()
      .patch('/v1/admin/promotions/nonexistent-id')
      .set('Cookie', adminCookie)
      .send({ value: 10 });

    expect(res.status).toBe(404);
  });

  // ── 6. Deactivate a promotion (admin) ─────────────────────────────────────

  it('DELETE /v1/admin/promotions/:id — deactivates promotion (204)', async () => {
    const res = await api()
      .delete(`/v1/admin/promotions/${fixedPromoId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('POST /v1/promotions/validate-coupon — deactivated coupon returns 400', async () => {
    const res = await api()
      .post('/v1/promotions/validate-coupon')
      .send({ code: 'E2E-FIX50', ...CART });

    expect(res.status).toBe(400);
  });

  // ── 7. Auth guards ─────────────────────────────────────────────────────────

  it('GET /v1/admin/promotions — 401 without token', async () => {
    const res = await api().get('/v1/admin/promotions');
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/promotions — 401 without token', async () => {
    const res = await api()
      .post('/v1/admin/promotions')
      .send({
        name: { default: 'Test' },
        type: 'PERCENTAGE',
        applicationMethod: 'COUPON',
        value: 10,
      });
    expect(res.status).toBe(401);
  });

  it('DELETE /v1/admin/promotions/:id — 401 without token', async () => {
    const res = await api().delete(`/v1/admin/promotions/${percentagePromoId}`);
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Accept-Language matrix (§1.14 BLOCKER 6 — E5)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Closes the §1.14 BLOCKER 6 finding for the promotions module. The matrix
// targets the admin GET /v1/admin/promotions/:id route (the only read path
// returning a stored `Promotion.name` Translatable; the storefront-public
// validate-coupon / automatic endpoints take input only).
//
// Out-of-process: the API on :53001 already mounts ApiResponseInterceptor +
// TranslatableInterceptor globally, so the matrix exercises the live chain.

describe('Accept-Language matrix (E5 §1.14 BLOCKER 6 — promotions)', () => {
  const SUFFIX = '@e2e-promo-matrix.test';
  const PWD = 'StrongPass1!';
  let matrixPrisma: PrismaClient;
  let matrixCookie: string;
  let matrixPromoId: string;

  beforeAll(async () => {
    matrixPrisma = createTestPrisma();

    await matrixPrisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await matrixPrisma.role.deleteMany({ where: { name: 'E2E-Promo-Matrix-Admin' } });
    await matrixPrisma.promotion.deleteMany({
      where: { name: { path: ['default'], string_starts_with: 'E2E-Matrix-Promo' } },
    });

    await createUserWithRole(matrixPrisma, {
      email: `admin${SUFFIX}`,
      password: PWD,
      role: 'ADMIN',
      permissions: ['promotions:view'],
      firstName: 'Promo',
      lastName: 'Matrix',
    });
    matrixCookie = await loginAs(`admin${SUFFIX}`, PWD);

    const promo = await matrixPrisma.promotion.create({
      data: {
        // `default` and the secondary locale carry the same value; the store's
        // default locale carries a distinct one (see products.e2e-spec.ts matrix).
        name: {
          default: 'E2E-Matrix-Promo secondary-locale',
          [STORE_SECONDARY_LOCALE]: 'E2E-Matrix-Promo secondary-locale',
          [STORE_DEFAULT_LOCALE]: 'E2E-Matrix-Promo default-locale',
        },
        type: 'PERCENTAGE',
        applicationMethod: 'COUPON',
        couponCode: 'E2E-MATRIX-PROMO',
        value: 10,
        isActive: true,
      },
    });
    matrixPromoId = promo.id;
  });

  afterAll(async () => {
    await matrixPrisma.promotionUsage.deleteMany({ where: { promotionId: matrixPromoId } });
    await matrixPrisma.promotion.deleteMany({ where: { id: matrixPromoId } });
    await matrixPrisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await matrixPrisma.role.deleteMany({ where: { name: 'E2E-Promo-Matrix-Admin' } });
    await matrixPrisma.$disconnect();
  });

  it('resolves Translatable name to the store default locale', async () => {
    const res = await api()
      .get(`/v1/admin/promotions/${matrixPromoId}`)
      .set('Cookie', matrixCookie)
      .set('Accept-Language', STORE_DEFAULT_LOCALE);
    expect(res.status).toBe(200);
    expect(res.body.data?.name).toBe('E2E-Matrix-Promo default-locale');
  });

  it('resolves Translatable name to the store secondary locale', async () => {
    const res = await api()
      .get(`/v1/admin/promotions/${matrixPromoId}`)
      .set('Cookie', matrixCookie)
      .set('Accept-Language', STORE_SECONDARY_LOCALE);
    expect(res.status).toBe(200);
    expect(res.body.data?.name).toBe('E2E-Matrix-Promo secondary-locale');
  });

  it('returns full Translatable object when X-Resolve-Locale: false', async () => {
    const res = await api()
      .get(`/v1/admin/promotions/${matrixPromoId}`)
      .set('Cookie', matrixCookie)
      .set('X-Resolve-Locale', 'false');
    expect(res.status).toBe(200);
    expect(res.body.data?.name).toEqual({
      default: 'E2E-Matrix-Promo secondary-locale',
      [STORE_SECONDARY_LOCALE]: 'E2E-Matrix-Promo secondary-locale',
      [STORE_DEFAULT_LOCALE]: 'E2E-Matrix-Promo default-locale',
    });
  });

  it('falls through to the store default rung on an unsupported Accept-Language (de)', async () => {
    const res = await api()
      .get(`/v1/admin/promotions/${matrixPromoId}`)
      .set('Cookie', matrixCookie)
      .set('Accept-Language', 'de');
    expect(res.status).toBe(200);
    // `default` and the secondary locale carry the same value and the store's
    // default locale differs, so only the default rung can produce this
    // string. An unsupported locale must reach it.
    expect(res.body.data?.name).toBe('E2E-Matrix-Promo default-locale');
  });
});
