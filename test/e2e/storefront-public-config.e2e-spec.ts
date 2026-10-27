/**
 * Public storefront config surface (plan I phase I1, findings D2, D4, D5, D6, D7).
 *
 * Every setting the storefront needs to stop hardcoding lived behind an
 * admin-gated route, so renaming the store, changing its currency or
 * configuring a pixel changed nothing a customer could ever see. This spec
 * pins the three things a unit test cannot reach: that the route really is
 * anonymous, that the payload is an allowlist rather than a settings dump, and
 * that an admin PATCH reaches it.
 *
 * Real dockerized DB per constitution §3.8. Every row it writes is restored in
 * teardown, because the settings it touches are global and a leftover value
 * would silently change what every other suite renders.
 */
import { PrismaClient } from '@prisma/client';
import {
  ADMIN,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
  api,
  createTestPrisma,
  flushRedisKeys,
  loginAs,
} from './helpers';

interface PublicConfig {
  identity: {
    storeName: unknown;
    contactEmail: string | null;
    phone: string | null;
    socialLinks: Record<string, string>;
    logoUrl: string | null;
  };
  currency: { code: string; symbol: string; decimalPlaces: number };
  locales: { supportedLocales: string[]; defaultLocale: string };
  inventory: { lowStockThreshold: number };
  pixels: {
    googleAnalyticsId: string | null;
    metaPixelId: string | null;
    tiktokPixelId: string | null;
    snapPixelId: string | null;
  };
}

const CACHE_PATTERN = 'storefront:config';

/** The service caches for 60 s; every read that must see a fresh write goes through this. */
async function readConfig(headers: Record<string, string> = {}): Promise<PublicConfig> {
  await flushRedisKeys(CACHE_PATTERN);
  const req = api().get('/v1/storefront/config');
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  const res = await req.expect(200);
  return res.body.data as PublicConfig;
}

describe('GET /v1/storefront/config', () => {
  let prisma: PrismaClient;
  let adminCookie: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('answers an anonymous request with the five allowlisted groups', async () => {
    const config = await readConfig();
    expect(Object.keys(config).sort()).toEqual([
      'currency',
      'identity',
      'inventory',
      'locales',
      'pixels',
    ]);
  });

  it('is not cacheable by a browser, per §3.15-A', async () => {
    await flushRedisKeys(CACHE_PATTERN);
    const res = await api().get('/v1/storefront/config').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['etag']).toBeUndefined();
  });

  it('resolves the store name for the requested locale', async () => {
    // Both locales the active fixture serves, not a literal pair. The store
    // name is one value per install rather than per language, so what is
    // asserted is that it resolved to a string at all rather than shipping the
    // Translatable object through to the client.
    const primary = await readConfig({ 'X-Locale': STORE_DEFAULT_LOCALE });
    const secondary = await readConfig({ 'X-Locale': STORE_SECONDARY_LOCALE });
    expect(typeof primary.identity.storeName).toBe('string');
    expect(typeof secondary.identity.storeName).toBe('string');
  });

  it('never carries a setting outside the allowlist', async () => {
    await flushRedisKeys(CACHE_PATTERN);
    const res = await api().get('/v1/storefront/config').expect(200);
    const body = JSON.stringify(res.body);
    for (const forbidden of [
      'address',
      'pauseAll',
      'guestCheckoutEnabled',
      'minimumOrderAmount',
      'timezone',
      'numberPrefix',
      'reservationSettings',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('reflects an admin store-name change on the next uncached read', async () => {
    const before = await prisma.storeSetting.findUnique({
      where: { group_key: { group: 'general', key: 'storeName' } },
    });
    // Keyed by the locales the active fixture enables, not a literal pair: a
    // Translatable carrying a locale the store has not enabled is refused by
    // the DTO (plan E1.3.4), so a hardcoded `fr` key 400s under a fixture
    // that does not serve French.
    const sentinel = {
      default: 'e2e-i1-sentinel',
      [STORE_DEFAULT_LOCALE]: 'e2e-i1-sentinel',
      [STORE_SECONDARY_LOCALE]: 'e2e-i1-sentinel',
    };
    try {
      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ storeName: sentinel })
        .expect(200);

      const config = await readConfig({ 'X-Locale': STORE_DEFAULT_LOCALE });
      expect(config.identity.storeName).toBe('e2e-i1-sentinel');
    } finally {
      if (before) {
        await prisma.storeSetting.update({
          where: { group_key: { group: 'general', key: 'storeName' } },
          data: { value: before.value as never },
        });
      } else {
        await prisma.storeSetting.delete({
          where: { group_key: { group: 'general', key: 'storeName' } },
        });
      }
      await flushRedisKeys(CACHE_PATTERN);
    }
  });

  it('reflects a configured contact email and drops the blank social platforms', async () => {
    const keys = ['contactEmail', 'socialLinks'] as const;
    const before = await prisma.storeSetting.findMany({
      where: { group: 'general', key: { in: [...keys] } },
    });
    try {
      await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({
          contactEmail: 'e2e-i1@example.test',
          socialLinks: { facebook: 'https://facebook.com/e2e-i1', instagram: '', twitter: '' },
        })
        .expect(200);

      const config = await readConfig();
      expect(config.identity.contactEmail).toBe('e2e-i1@example.test');
      expect(config.identity.socialLinks).toEqual({
        facebook: 'https://facebook.com/e2e-i1',
      });
    } finally {
      await prisma.storeSetting.deleteMany({ where: { group: 'general', key: { in: [...keys] } } });
      for (const row of before) {
        await prisma.storeSetting.create({
          data: { group: row.group, key: row.key, value: row.value as never },
        });
      }
      await flushRedisKeys(CACHE_PATTERN);
    }
  });

  it('carries the store currency without the admin currency roster', async () => {
    const config = await readConfig();
    expect(Object.keys(config.currency).sort()).toEqual(['code', 'decimalPlaces', 'symbol']);
    expect(config.currency.code).toMatch(/^[A-Z]{3}$/);
  });

  it('carries the configured locales and a low-stock threshold', async () => {
    const config = await readConfig();
    expect(config.locales.supportedLocales).toContain(config.locales.defaultLocale);
    expect(Number.isInteger(config.inventory.lowStockThreshold)).toBe(true);
  });

  it('round-trips the appearance logo, which the admin page could never save', async () => {
    // The admin appearance page has written `logoUrl` since it shipped, and
    // neither SETTINGS_KEYS nor UpdateSettingsDto had the key, so the request
    // schema stripped the body and the API answered 200 with nothing stored.
    const before = await prisma.storeSetting.findUnique({
      where: { group_key: { group: 'appearance', key: 'logoUrl' } },
    });
    try {
      const patched = await api()
        .patch('/v1/admin/settings')
        .set('Cookie', adminCookie)
        .send({ logoUrl: 'https://cdn.example.test/e2e-i3-logo.png' })
        .expect(200);
      expect(patched.body.data.appearance).toEqual({
        logoUrl: 'https://cdn.example.test/e2e-i3-logo.png',
        faviconUrl: '',
      });

      const config = await readConfig();
      expect(config.identity.logoUrl).toBe('https://cdn.example.test/e2e-i3-logo.png');
    } finally {
      await prisma.storeSetting.deleteMany({ where: { group: 'appearance', key: 'logoUrl' } });
      if (before) {
        await prisma.storeSetting.create({
          data: { group: 'appearance', key: 'logoUrl', value: before.value as never },
        });
      }
      await flushRedisKeys(CACHE_PATTERN);
    }
  });

  it('refuses a logo URL that is not http(s) or a site-relative path', async () => {
    // The value is rendered into an <img src> and into the Organization
    // JSON-LD, so a javascript: URL has to be refused at the boundary.
    await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ logoUrl: 'javascript:alert(1)' })
      .expect(400);
  });

  it('reflects a pixel configured through the admin analytics route', async () => {
    const before = await prisma.storeSetting.findUnique({
      where: { group_key: { group: 'analytics', key: 'pixels' } },
    });
    try {
      await api()
        .patch('/v1/admin/analytics/pixels')
        .set('Cookie', adminCookie)
        .send({ googleAnalyticsId: 'G-E2EI1TEST' })
        .expect(200);

      const config = await readConfig();
      expect(config.pixels).toEqual({
        googleAnalyticsId: 'G-E2EI1TEST',
        metaPixelId: null,
        tiktokPixelId: null,
        snapPixelId: null,
      });
    } finally {
      if (before) {
        await prisma.storeSetting.update({
          where: { group_key: { group: 'analytics', key: 'pixels' } },
          data: { value: before.value as never },
        });
      } else {
        await prisma.storeSetting.deleteMany({ where: { group: 'analytics', key: 'pixels' } });
      }
      await flushRedisKeys(CACHE_PATTERN);
    }
  });
});
