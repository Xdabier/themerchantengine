import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
  STORE_CONFIG,
} from '../../../test/e2e/helpers';

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-shipping.test';
const TEST_PASSWORD = 'StrongPass1';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Shipping (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let adminRoleId: string | undefined;

  let zone1Id: string;
  let flatMethodId: string;
  let weightMethodId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Clean up previous runs ────────────────────────────────────────────────
    await prisma.shippingMethod.deleteMany({
      where: { zone: { countries: { has: 'E2' } } },
    });
    await prisma.shippingZone.deleteMany({ where: { countries: { has: 'E2' } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });

    // ── Create admin user with the shipping permission set ────────────────────
    const { roleId } = await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['shipping:view', 'shipping:create', 'shipping:update', 'shipping:delete'],
      firstName: 'Shipping',
      lastName: 'Admin',
    });
    adminRoleId = roleId;

    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);
  });

  afterAll(async () => {
    await prisma.shippingMethod.deleteMany({
      where: { zone: { countries: { has: 'E2' } } },
    });
    await prisma.shippingZone.deleteMany({ where: { countries: { has: 'E2' } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    if (adminRoleId) {
      await prisma.role.deleteMany({ where: { id: adminRoleId } });
    }
    await prisma.$disconnect();
  });

  // ── 1. Create shipping zones ───────────────────────────────────────────────

  it('POST /v1/admin/shipping/zones — creates high-priority zone (priority 1)', async () => {
    const res = await api()
      .post('/v1/admin/shipping/zones')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E Zone Priority', en: 'E2E Zone Priority' },
        countries: ['E2'],
        priority: 1,
        isActive: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    zone1Id = res.body.data.id as string;
  });

  it('POST /v1/admin/shipping/zones — creates low-priority zone (priority 10)', async () => {
    const res = await api()
      .post('/v1/admin/shipping/zones')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E Zone Fallback', en: 'E2E Zone Fallback' },
        countries: ['E2'],
        priority: 10,
        isActive: true,
      });

    expect(res.status).toBe(201);
    // zone2 is used for priority fallback verification in calculateRates tests
    void res.body.data.id;
  });

  // ── 2. List zones ──────────────────────────────────────────────────────────

  it('GET /v1/admin/shipping/zones — returns both zones', async () => {
    const res = await api().get('/v1/admin/shipping/zones').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  // ── 3. Create shipping methods ─────────────────────────────────────────────

  it('POST /v1/admin/shipping/methods — creates FLAT_RATE method in zone 1', async () => {
    const res = await api()
      .post('/v1/admin/shipping/methods')
      .set('Cookie', adminCookie)
      .send({
        zoneId: zone1Id,
        name: { default: 'Standard', en: 'Standard' },
        type: 'FLAT_RATE',
        price: 15,
        estimatedDaysMin: 3,
        estimatedDaysMax: 5,
        isActive: true,
        sortOrder: 0,
      });

    expect(res.status).toBe(201);
    flatMethodId = res.body.data.id as string;
  });

  it('POST /v1/admin/shipping/methods — creates WEIGHT_BASED method in zone 1', async () => {
    const res = await api()
      .post('/v1/admin/shipping/methods')
      .set('Cookie', adminCookie)
      .send({
        zoneId: zone1Id,
        name: { default: 'Express', en: 'Express' },
        type: 'WEIGHT_BASED',
        weightRanges: [
          { minKg: 0, maxKg: 5, price: 20 },
          { minKg: 5.01, maxKg: 20, price: 40 },
        ],
        estimatedDaysMin: 1,
        estimatedDaysMax: 2,
        isActive: true,
        sortOrder: 1,
      });

    expect(res.status).toBe(201);
    weightMethodId = res.body.data.id as string;
  });

  it('POST /v1/admin/shipping/methods — 404 for unknown zoneId', async () => {
    const res = await api()
      .post('/v1/admin/shipping/methods')
      .set('Cookie', adminCookie)
      .send({
        zoneId: 'nonexistent-zone-id',
        name: { default: 'Bad' },
        type: 'FLAT_RATE',
        price: 10,
      });

    expect(res.status).toBe(404);
  });

  // ── 4. Calculate rates — zone priority resolution ──────────────────────────

  it('POST /v1/shipping/rates — returns methods from highest-priority matching zone', async () => {
    const res = await api()
      .post('/v1/shipping/rates')
      .send({
        country: 'E2',
        items: [{ weight: 1, quantity: 2 }], // 2 kg total
        subtotal: 100,
      });

    expect(res.status).toBe(200);
    // Both methods are in zone1 (priority 1) — zone2 (priority 10) is never used
    const ids = (res.body.data as Array<{ methodId: string }>).map((r) => r.methodId);
    expect(ids).toContain(flatMethodId);
    expect(ids).toContain(weightMethodId);
  });

  it('POST /v1/shipping/rates — returns empty for unmatched country', async () => {
    const res = await api()
      .post('/v1/shipping/rates')
      .send({
        country: 'XX',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 50,
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('POST /v1/shipping/rates — FLAT_RATE price is 15', async () => {
    const res = await api()
      .post('/v1/shipping/rates')
      .send({
        country: 'E2',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 80,
      });

    expect(res.status).toBe(200);
    const flat = (res.body.data as Array<{ methodId: string; price: number }>).find(
      (r) => r.methodId === flatMethodId,
    );
    expect(flat?.price).toBe(15);
  });

  it('POST /v1/shipping/rates — WEIGHT_BASED selects correct range (2 kg → price 20)', async () => {
    const res = await api()
      .post('/v1/shipping/rates')
      .send({
        country: 'E2',
        items: [{ weight: 2, quantity: 1 }], // 2 kg — first range
        subtotal: 80,
      });

    expect(res.status).toBe(200);
    const weighted = (res.body.data as Array<{ methodId: string; price: number }>).find(
      (r) => r.methodId === weightMethodId,
    );
    expect(weighted?.price).toBe(20);
  });

  // ── 5. Update a zone ───────────────────────────────────────────────────────

  it('PATCH /v1/admin/shipping/zones/:id — updates priority', async () => {
    const res = await api()
      .patch(`/v1/admin/shipping/zones/${zone1Id}`)
      .set('Cookie', adminCookie)
      .send({ priority: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.priority).toBe(2);
  });

  // ── 6. Deactivate a method ────────────────────────────────────────────────

  it('DELETE /v1/admin/shipping/methods/:id — deactivates (204, isActive=false)', async () => {
    const res = await api()
      .delete(`/v1/admin/shipping/methods/${weightMethodId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('POST /v1/shipping/rates — deactivated method no longer returned', async () => {
    const res = await api()
      .post('/v1/shipping/rates')
      .send({
        country: 'E2',
        items: [{ weight: 2, quantity: 1 }],
        subtotal: 80,
      });

    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ methodId: string }>).map((r) => r.methodId);
    expect(ids).not.toContain(weightMethodId);
    expect(ids).toContain(flatMethodId); // still active
  });

  // ── 7. Auth guards ─────────────────────────────────────────────────────────

  it('GET /v1/admin/shipping/zones — 401 without token', async () => {
    const res = await api().get('/v1/admin/shipping/zones');
    expect(res.status).toBe(401);
  });

  it('POST /v1/shipping/rates — 200 without token (public endpoint)', async () => {
    const res = await api()
      .post('/v1/shipping/rates')
      .send({ country: 'E2', items: [{ weight: 1, quantity: 1 }], subtotal: 50 });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Accept-Language matrix (§1.14 BLOCKER 6 — E5)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Closes the §1.14 BLOCKER 6 finding for the shipping module. Targets
// `POST /v1/shipping/rates` (public storefront) which returns an array of
// rate entries containing the resolved `ShippingMethod.name` Translatable.

describe('Accept-Language matrix (E5 §1.14 BLOCKER 6 — shipping)', () => {
  let matrixPrisma: PrismaClient;
  let matrixZoneId: string;
  let matrixMethodId: string;

  beforeAll(async () => {
    matrixPrisma = createTestPrisma();

    await matrixPrisma.shippingMethod.deleteMany({
      where: { zone: { countries: { has: 'M5' } } },
    });
    await matrixPrisma.shippingZone.deleteMany({ where: { countries: { has: 'M5' } } });

    const zone = await matrixPrisma.shippingZone.create({
      data: {
        name: { default: 'Zone matrice FR', fr: 'Zone matrice FR', en: 'Matrix Zone EN' },
        countries: ['M5'],
        priority: 1,
        isActive: true,
      },
    });
    matrixZoneId = zone.id;

    const method = await matrixPrisma.shippingMethod.create({
      data: {
        zoneId: matrixZoneId,
        name: { default: 'Méthode matrice FR', fr: 'Méthode matrice FR', en: 'Matrix Method EN' },
        type: 'FLAT_RATE',
        price: 15,
        isActive: true,
      },
    });
    matrixMethodId = method.id;
  });

  afterAll(async () => {
    await matrixPrisma.shippingMethod.deleteMany({ where: { id: matrixMethodId } });
    await matrixPrisma.shippingZone.deleteMany({ where: { id: matrixZoneId } });
    await matrixPrisma.$disconnect();
  });

  const ratesBody = { country: 'M5', items: [{ weight: 1, quantity: 1 }], subtotal: 50 };

  it('resolves Translatable name to en when Accept-Language: en', async () => {
    const res = await api().post('/v1/shipping/rates').set('Accept-Language', 'en').send(ratesBody);
    expect(res.status).toBe(200);
    const rates = res.body.data as Array<{ name: unknown }>;
    expect(rates.length).toBeGreaterThan(0);
    expect(rates[0].name).toBe('Matrix Method EN');
  });

  it('resolves Translatable name to fr when Accept-Language: fr', async () => {
    const res = await api().post('/v1/shipping/rates').set('Accept-Language', 'fr').send(ratesBody);
    expect(res.status).toBe(200);
    const rates = res.body.data as Array<{ name: unknown }>;
    expect(rates.length).toBeGreaterThan(0);
    expect(rates[0].name).toBe('Méthode matrice FR');
  });

  it('returns full Translatable object when X-Resolve-Locale: false', async () => {
    const res = await api()
      .post('/v1/shipping/rates')
      .set('X-Resolve-Locale', 'false')
      .send(ratesBody);
    expect(res.status).toBe(200);
    const rates = res.body.data as Array<{ name: unknown }>;
    expect(rates.length).toBeGreaterThan(0);
    expect(rates[0].name).toEqual({
      default: 'Méthode matrice FR',
      fr: 'Méthode matrice FR',
      en: 'Matrix Method EN',
    });
  });

  it('falls through to the store default rung on an unsupported Accept-Language (de)', async () => {
    const res = await api().post('/v1/shipping/rates').set('Accept-Language', 'de').send(ratesBody);
    expect(res.status).toBe(200);
    const rates = res.body.data as Array<{ name: unknown }>;
    expect(rates.length).toBeGreaterThan(0);
    // The chain is the requested locale, then the store default, then
    // `default` (DR-31). `default` and `fr` carry the same value and `en`
    // differs, so on an en-default store only that rung produces the string.
    const expected =
      STORE_CONFIG.localization.defaultLocale === 'en' ? 'Matrix Method EN' : 'Méthode matrice FR';
    expect(rates[0].name).toBe(expected);
  });
});
