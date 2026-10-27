import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
  ADMIN,
  OTHER_CURRENCY_CONFIG,
  STORE_CURRENCY_CONFIG,
} from '../../../test/e2e/helpers';

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-currencies.test';
const TEST_PASSWORD = 'StrongPass1';

/** The seed leaves the store on the fixture currency alone (prisma/seed.ts, DR-31). */
const STORE = STORE_CURRENCY_CONFIG;
const OTHER = OTHER_CURRENCY_CONFIG;

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Currencies (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });

    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Known starting state: one currency, the store default, catalogue-complete config.
    await api()
      .patch('/v1/admin/currencies')
      .set('Cookie', adminCookie)
      .send({ enabled: [STORE.code], defaultCode: STORE.code })
      .expect(200);
  });

  afterAll(async () => {
    // Leave the store on its one currency for every other suite.
    await api()
      .patch('/v1/admin/currencies')
      .set('Cookie', adminCookie)
      .send({ enabled: [STORE.code], defaultCode: STORE.code });

    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── GET /v1/admin/currencies/store ──────────────────────────────────────────

  describe('GET /v1/admin/currencies/store', () => {
    it('returns the configured store currency plus the enabled set', async () => {
      const res = await api()
        .get('/v1/admin/currencies/store')
        .set('Cookie', adminCookie)
        .expect(200);

      const { data } = res.body;
      expect(data.code).toBe(STORE.code);
      expect(data.symbol).toBe(STORE.symbol);
      expect(data.decimalPlaces).toBe(STORE.decimalPlaces);
      expect(data.enabled).toEqual([STORE.code]);
    });

    it('rejects an anonymous caller', async () => {
      await api().get('/v1/admin/currencies/store').expect(401);
    });

    /**
     * The executable half of DR-26: the route is authenticated-only, so a signed-in
     * operator whose role grants zero permissions must still be able to read the
     * store currency. If this ever 403s, the route was re-gated and the admin's
     * money rendering silently regresses for Manager / Support.
     */
    it('serves a signed-in user whose role carries zero permissions', async () => {
      const email = `no-perms${TEST_SUFFIX}`;
      await createUserWithRole(prisma, {
        email,
        password: TEST_PASSWORD,
        role: 'SUPPORT',
        permissions: [],
        firstName: 'NoPerms',
        lastName: 'Operator',
      });

      const cookie = await loginAs(email, TEST_PASSWORD);

      // Same user cannot read the permission-gated currencies list …
      await api().get('/v1/admin/currencies').set('Cookie', cookie).expect(403);

      // … but can read the store currency.
      const res = await api().get('/v1/admin/currencies/store').set('Cookie', cookie).expect(200);
      expect(res.body.data.code).toBe(STORE.code);
    });

    /**
     * The other half of the boundary: permission-free is not the same as open.
     * One API process serves the storefront too, so a customer session must not
     * reach an /v1/admin route just because the handler carries no @Permissions.
     */
    it('rejects a signed-in storefront customer', async () => {
      const email = `customer${TEST_SUFFIX}`;
      await createUserWithRole(prisma, {
        email,
        password: TEST_PASSWORD,
        role: 'CUSTOMER',
        firstName: 'Shopper',
        lastName: 'Person',
      });

      const cookie = await loginAs(email, TEST_PASSWORD);

      await api().get('/v1/admin/currencies/store').set('Cookie', cookie).expect(403);
    });
  });

  // ── PATCH /v1/admin/currencies keeps currencyConfig in sync ─────────────────

  describe('PATCH /v1/admin/currencies', () => {
    it('syncs localization.currencyConfig to the new default currency', async () => {
      await api()
        .patch('/v1/admin/currencies')
        .set('Cookie', adminCookie)
        .send({ enabled: [STORE.code, OTHER.code], defaultCode: OTHER.code })
        .expect(200);

      const settings = await api().get('/v1/admin/settings').set('Cookie', adminCookie).expect(200);

      expect(settings.body.data.localization.currencyConfig).toEqual(OTHER);

      const store = await api()
        .get('/v1/admin/currencies/store')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(store.body.data.code).toBe(OTHER.code);
      expect(store.body.data.symbol).toBe(OTHER.symbol);
      // The enabled set is reported in catalogue order, which no caller relies on.
      expect([...store.body.data.enabled].sort()).toEqual([STORE.code, OTHER.code].sort());
    });

    it('restores the store currency as the default and resyncs the config', async () => {
      await api()
        .patch('/v1/admin/currencies')
        .set('Cookie', adminCookie)
        .send({ enabled: [STORE.code], defaultCode: STORE.code })
        .expect(200);

      const settings = await api().get('/v1/admin/settings').set('Cookie', adminCookie).expect(200);

      expect(settings.body.data.localization.currencyConfig).toEqual(STORE);
    });
  });
});
