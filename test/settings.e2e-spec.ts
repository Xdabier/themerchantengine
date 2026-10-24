import { PrismaClient } from '@prisma/client';
import {
  api,
  loginAs,
  createUserWithRole,
  createTestPrisma,
  ADMIN,
  OTHER_CURRENCY_CONFIG,
  STORE_CONFIG,
  STORE_CURRENCY_CONFIG,
} from './e2e/helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-settings.test';
const TEST_PASSWORD = 'StrongPass1';

// ── Test Suite ──────────────────────────────────────────────────────────────────

describe('Settings (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // Clean up old test data
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.storeSetting.deleteMany({});

    // Login as seeded admin (has SUPER_ADMIN role with all permissions)
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── GET /v1/admin/settings ────────────────────────────────────────────────

  describe('GET /v1/admin/settings', () => {
    it('returns all settings grouped', async () => {
      const response = await api().get('/v1/admin/settings').set('Cookie', adminCookie).expect(200);

      const { data } = response.body;

      expect(data).toHaveProperty('general');
      expect(data).toHaveProperty('localization');
      expect(data).toHaveProperty('checkout');
      expect(data).toHaveProperty('inventory');
      expect(data).toHaveProperty('orders');
      expect(data).toHaveProperty('returns');
      expect(data).toHaveProperty('shipping');

      // Verify defaults are populated
      expect(data.general.storeName).toBeDefined();
      expect(data.localization.supportedLocales).toEqual([
        ...STORE_CONFIG.localization.supportedLocales,
      ]);
      expect(data.checkout.guestCheckoutEnabled).toBe(true);
    });

    it('rejects requests without settings:view permission', async () => {
      // Create a user with CUSTOMER role (no admin permissions)
      const noPermEmail = `no-perm-user${TEST_SUFFIX}`;
      await createUserWithRole(prisma, {
        email: noPermEmail,
        password: TEST_PASSWORD,
        role: 'CUSTOMER',
        firstName: 'NoPerms',
        lastName: 'User',
      });

      const cookie = await loginAs(noPermEmail, TEST_PASSWORD);

      await api().get('/v1/admin/settings').set('Cookie', cookie).expect(403);
    });

    it('rejects requests without authentication', async () => {
      await api().get('/v1/admin/settings').expect(401);
    });
  });

  // ── PATCH /v1/admin/settings ──────────────────────────────────────────────

  describe('PATCH /v1/admin/settings', () => {
    it('updates a single setting', async () => {
      const response = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({
          contactEmail: 'support@company.com',
        })
        .expect(200);

      const { data } = response.body;
      expect(data.general.contactEmail).toBe('support@company.com');

      // Verify it persists
      const dbSetting = await prisma.storeSetting.findUnique({
        where: { group_key: { group: 'general', key: 'contactEmail' } },
      });
      expect(dbSetting?.value).toBe('support@company.com');
    });

    it('updates multiple settings at once', async () => {
      const response = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({
          contactEmail: 'newemail@company.com',
          guestCheckoutEnabled: false,
          minimumOrderAmount: 100,
        })
        .expect(200);

      const { data } = response.body;
      expect(data.general.contactEmail).toBe('newemail@company.com');
      expect(data.checkout.guestCheckoutEnabled).toBe(false);
      expect(data.checkout.minimumOrderAmount).toBe(100);
    });

    it('validates Translatable objects', async () => {
      const response = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .set('X-Resolve-Locale', 'false')
        .send({
          storeName: {
            default: 'Acme Corp',
            fr: 'Acme Corp',
            en: 'Acme Corp',
          },
        })
        .expect(200);

      expect(response.body.data.general.storeName).toEqual({
        default: 'Acme Corp',
        fr: 'Acme Corp',
        en: 'Acme Corp',
      });
    });

    it('refuses a phone that is not bare E.164 (400)', async () => {
      const res = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ phone: '+216 71 000 000' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses a timezone that is not an IANA zone name (400)', async () => {
      const res = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ timezone: 'GMT+1' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses an array where a Translatable object belongs (400)', async () => {
      const res = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ storeName: [] })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses a store name without a default value (400)', async () => {
      const res = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ storeName: { en: 'No default' } })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    // A partial currencyConfig patch used to replace the whole JSON object and
    // destroy `symbol` + `decimalPlaces` for the entire store. The service now
    // completes the missing fields from the currency catalogue.
    it('completes a partial currencyConfig from the catalogue instead of clobbering it', async () => {
      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ currencyConfig: { code: OTHER_CURRENCY_CONFIG.code } })
        .expect(200);

      const afterChange = await api()
        .get('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(afterChange.body.data.localization.currencyConfig).toEqual(OTHER_CURRENCY_CONFIG);

      // Restore the store currency for every other suite.
      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ currencyConfig: { code: STORE_CURRENCY_CONFIG.code } })
        .expect(200);

      const restored = await api().get('/v1/admin/settings').set('Cookie', adminCookie).expect(200);

      expect(restored.body.data.localization.currencyConfig).toEqual(STORE_CURRENCY_CONFIG);
    });

    it('keeps an explicit currencyConfig override untouched', async () => {
      const override = { code: STORE_CURRENCY_CONFIG.code, symbol: 'XX', decimalPlaces: 3 };
      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ currencyConfig: override })
        .expect(200);

      const res = await api().get('/v1/admin/settings').set('Cookie', adminCookie).expect(200);
      expect(res.body.data.localization.currencyConfig).toEqual(override);

      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ currencyConfig: STORE_CURRENCY_CONFIG })
        .expect(200);
    });

    it('writes every group the admin settings screens edit', async () => {
      // Plan E3.1. The ValidationPipe runs with `forbidNonWhitelisted`, so a
      // key the settings screens send and `UpdateSettingsDto` does not declare
      // is a 400 with no compile error anywhere. This walks one key per group
      // the gate B screens own, in one body, so a dropped decorator fails here
      // rather than on the operator's screen.
      const response = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({
          brandName: 'demo-store',
          description: { default: 'A demo store' },
          baseColors: { primary: '#1F2937', secondary: null, accent: null },
          fontKit: 'latin-rounded',
          symbolPosition: 'after',
          decimalSeparator: ',',
          thousandsSeparator: ' ',
          taxDisplay: 'TTC',
          vatRate: 0.19,
          rtlLocales: [],
          storefront: '',
          admin: '',
          api: '',
          legalName: { default: 'Demo Store SARL' },
          tradingName: { default: 'Demo Store' },
          streetAddress: { default: '1 Main Street' },
          addressLocality: 'Paris',
          addressRegion: 'Ile-de-France',
          postalCode: '75001',
          addressCountry: 'FR',
        })
        .expect(200);

      const { data } = response.body;
      expect(data.identity.brandName).toBe('demo-store');
      expect(data.brand.fontKit).toBe('latin-rounded');
      expect(data.money.symbolPosition).toBe('after');
      expect(data.money.taxDisplay).toBe('TTC');
      expect(data.domains.storefront).toBe('');
      expect(data.business.addressLocality).toBe('Paris');
      expect(data.business.addressCountry).toBe('FR');
    });

    it('resolves a Translatable it just wrote, and falls back to the store default', async () => {
      // These four business keys were seed-only until this gate, so nothing had
      // ever proven the write-then-resolve round trip on them. The invoice
      // renderer and the Organization JSON-LD both read `legalName`.
      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ legalName: { default: 'Demo Store SARL', en: 'Demo Store Ltd', fr: 'Demo SARL' } })
        .expect(200);

      const raw = await api()
        .get('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .set('X-Resolve-Locale', 'false')
        .expect(200);
      expect(raw.body.data.business.legalName).toMatchObject({
        default: 'Demo Store SARL',
        en: 'Demo Store Ltd',
        fr: 'Demo SARL',
      });

      const french = await api()
        .get('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .set('Accept-Language', 'fr')
        .expect(200);
      expect(french.body.data.business.legalName).toBe('Demo SARL');

      // A locale the store does not serve resolves to the store's own default,
      // not to whichever locale happens to be first in the object.
      const unsupported = await api()
        .get('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .set('Accept-Language', 'de')
        .expect(200);
      expect(typeof unsupported.body.data.business.legalName).toBe('string');
      expect(unsupported.body.data.business.legalName).not.toBe('');
    });

    it('refuses a settings key the DTO does not declare', async () => {
      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ notASetting: 'x' })
        .expect(400);
    });

    it('rejects requests without settings:manage permission', async () => {
      // Create a user with settings:view but not settings:manage
      const viewOnlyEmail = `view-only${TEST_SUFFIX}`;
      await createUserWithRole(prisma, {
        email: viewOnlyEmail,
        password: TEST_PASSWORD,
        role: 'ADMIN',
        permissions: ['settings:view'],
        firstName: 'ViewOnly',
        lastName: 'User',
      });

      const cookie = await loginAs(viewOnlyEmail, TEST_PASSWORD);

      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', cookie)
        .send({ contactEmail: 'test@example.com' })
        .expect(403);
    });
  });

  // ── GET /v1/admin/settings/locales ────────────────────────────────────────

  describe('GET /v1/admin/settings/locales', () => {
    it('returns supported locales and default locale', async () => {
      const response = await api()
        .get('/v1/admin/settings/locales')
        .set('Cookie', adminCookie)
        .expect(200);

      const { data } = response.body;
      expect(data).toHaveProperty('supportedLocales');
      expect(data).toHaveProperty('defaultLocale');
      expect(Array.isArray(data.supportedLocales)).toBe(true);
      expect(typeof data.defaultLocale).toBe('string');
    });
  });

  // ── PATCH /v1/admin/settings/locales ──────────────────────────────────────

  describe('PATCH /v1/admin/settings/locales', () => {
    it('updates supported locales and default locale', async () => {
      const response = await api()
        .patch('/v1/admin/settings/locales')
        .set('Cookie', adminCookie)
        .send({
          supportedLocales: ['fr', 'en', 'ar'],
          defaultLocale: 'ar',
        })
        .expect(200);

      const { data } = response.body;
      expect(data.supportedLocales).toEqual(['fr', 'en', 'ar']);
      expect(data.defaultLocale).toBe('ar');

      // Verify persistence
      const locales = await api()
        .get('/v1/admin/settings/locales')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(locales.body.data.supportedLocales).toEqual(['fr', 'en', 'ar']);

      // Restore the store's own set through the same door, so the running
      // API refreshes its locale snapshot for every suite after this one.
      await api()
        .patch('/v1/admin/settings/locales')
        .set('Cookie', adminCookie)
        .send({
          supportedLocales: [...STORE_CONFIG.localization.supportedLocales],
          defaultLocale: STORE_CONFIG.localization.defaultLocale,
        })
        .expect(200);
    });

    it('rejects a locale outside the fr/en/ar catalogue', async () => {
      await api()
        .patch('/v1/admin/settings/locales')
        .set('Cookie', adminCookie)
        .send({ supportedLocales: ['fr', 'en', 'de'], defaultLocale: 'de' })
        .expect(400);
    });

    it('rejects when defaultLocale is not in supportedLocales', async () => {
      await api()
        .patch('/v1/admin/settings/locales')
        .set('Cookie', adminCookie)
        .send({
          supportedLocales: ['fr', 'en'],
          defaultLocale: 'de', // Not in supportedLocales
        })
        .expect(400);
    });

    it('requires both supportedLocales and defaultLocale', async () => {
      await api()
        .patch('/v1/admin/settings/locales')
        .set('Cookie', adminCookie)
        .send({
          supportedLocales: ['fr', 'en'],
        })
        .expect(400);
    });

    it('rejects requests without settings:manage permission', async () => {
      // Create a user with settings:view but not settings:manage
      const viewOnlyEmail = `view-only-locales${TEST_SUFFIX}`;
      await createUserWithRole(prisma, {
        email: viewOnlyEmail,
        password: TEST_PASSWORD,
        role: 'ADMIN',
        permissions: ['settings:view'],
        firstName: 'ViewOnly',
        lastName: 'Locales',
      });

      const cookie = await loginAs(viewOnlyEmail, TEST_PASSWORD);

      await api()
        .patch('/v1/admin/settings/locales')
        .set('Cookie', cookie)
        .send({ supportedLocales: ['en'], defaultLocale: 'en' })
        .expect(403);
    });
  });

  // ── DB override precedence ────────────────────────────────────────────────

  describe('DB override precedence', () => {
    it('DB values take precedence over defaults', async () => {
      // Set a custom value in DB
      await prisma.storeSetting.upsert({
        where: { group_key: { group: 'general', key: 'contactEmail' } },
        create: { group: 'general', key: 'contactEmail', value: 'dbvalue@test.com' },
        update: { value: 'dbvalue@test.com' },
      });

      const response = await api().get('/v1/admin/settings').set('Cookie', adminCookie).expect(200);

      expect(response.body.data.general.contactEmail).toBe('dbvalue@test.com');
    });
  });
});
