/**
 * The runtime store config endpoint (plan E1.2, DR-31).
 *
 * Pins what a unit test cannot: the route is anonymous, the payload is exactly
 * the five public groups, the browser cache headers are
 * the §3.15-A public-cacheable shape with no ETag, and an admin write through
 * either settings door is visible on the very next read without waiting for
 * the Redis window.
 *
 * Real dockerized DB per constitution §3.8. Every row it writes is restored
 * in teardown.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { ADMIN, api, createTestPrisma, flushRedisKeys, loginAs } from './helpers';
import { BRAND_TOKEN_KEYS, generatePalette } from '@common/brand';

const CACHE_PATTERN = 'store*:config';

interface StoreConfigPayload {
  identity: {
    storeName: unknown;
    brandName: string;
    description: unknown;
    contact: { email: string; phone: string };
    address: { country: string; region: string; postalCode: string | null };
  };
  brand: {
    baseColors: { primary: string; secondary: string | null; accent: string | null };
    generatedPalette?: { tokens: Record<string, string>; adjustments: unknown[] };
  };
  localization: { supportedLocales: string[]; defaultLocale: string; rtlLocales: string[] };
  money: {
    currencyCode: string;
    symbol: string;
    symbolPosition: string;
    decimalSeparator: string;
    thousandsSeparator: string;
    displayPrecision: number;
    taxDisplay: string;
    vatRate: number;
  };
  domains: { storefront: string; admin: string; api: string };
}

const TOUCHED: Array<[string, string]> = [
  ['identity', 'brandName'],
  ['brand', 'baseColors'],
  ['localization', 'rtlLocales'],
  ['localization', 'supportedLocales'],
  ['localization', 'defaultLocale'],
  ['money', 'symbolPosition'],
  ['money', 'taxDisplay'],
  ['money', 'vatRate'],
  ['domains', 'storefront'],
];

describe('GET /v1/store/config', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  const saved = new Map<string, Prisma.JsonValue | null>();

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    for (const [group, key] of TOUCHED) {
      const row = await prisma.storeSetting.findUnique({
        where: { group_key: { group, key } },
        select: { value: true },
      });
      saved.set(`${group}/${key}`, row ? row.value : null);
    }
  });

  afterAll(async () => {
    for (const [mapKey, value] of saved) {
      const [group, key] = mapKey.split('/');
      if (value === null) {
        await prisma.storeSetting.deleteMany({ where: { group, key } });
      } else {
        await prisma.storeSetting.upsert({
          where: { group_key: { group, key } },
          create: { group, key, value },
          update: { value },
        });
      }
    }
    await flushRedisKeys(CACHE_PATTERN);
    // Rows written by Prisma emit no `store-config.updated`, so the running
    // API's locale and money snapshots would keep this suite's values for
    // every suite after it. A same-value write through the settings doors
    // fires the event and refreshes them.
    const restored = await read();
    await api()
      .patch('/v1/admin/settings/locales')
      .set('Cookie', adminCookie)
      .send({
        supportedLocales: restored.body.localization.supportedLocales,
        defaultLocale: restored.body.localization.defaultLocale,
      })
      .expect(200);
    await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ rtlLocales: restored.body.localization.rtlLocales })
      .expect(200);
    await flushRedisKeys(CACHE_PATTERN);
    await prisma.$disconnect();
  });

  async function read(): Promise<{ body: StoreConfigPayload; headers: Record<string, string> }> {
    const res = await api().get('/v1/store/config').set('X-Resolve-Locale', 'false').expect(200);
    return { body: res.body.data as StoreConfigPayload, headers: res.headers };
  }

  it('is anonymous and returns exactly the five public groups', async () => {
    const { body } = await read();
    expect(Object.keys(body).sort()).toEqual(
      ['brand', 'domains', 'identity', 'localization', 'money'].sort(),
    );
    expect(body).not.toHaveProperty('license');
    expect(body.identity.storeName).toHaveProperty('default');
    expect(body.localization.supportedLocales).toContain(body.localization.defaultLocale);
    expect(body.money.currencyCode).toMatch(/^[A-Z]{3}$/);
    expect(body.money.decimalSeparator).not.toBe(body.money.thousandsSeparator);
  });

  it('carries the palette generated from the stored base colours', async () => {
    const { body } = await read();
    const palette = body.brand.generatedPalette;
    expect(palette).toBeDefined();
    expect(Object.keys(palette?.tokens ?? {}).sort()).toEqual([...BRAND_TOKEN_KEYS].sort());
    expect(palette).toEqual(generatePalette(body.brand.baseColors));
  });

  it('regenerates the palette when the base colours change', async () => {
    const before = (await read()).body.brand.generatedPalette;

    // Through the settings door, so the write emits the event that drops the
    // cache; `afterAll` restores the row from the TOUCHED snapshot.
    await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ baseColors: { primary: '#7a2f2f', secondary: null, accent: null } })
      .expect(200);

    const after = (await read()).body.brand.generatedPalette;
    expect(after?.tokens['--brand-primary']).toBe('#7a2f2f');
    expect(after).not.toEqual(before);
  });

  it('is browser-cacheable for the Redis window and never carries an ETag (§3.15-A)', async () => {
    const { headers } = await read();
    expect(headers['cache-control']).toBe('public, max-age=60');
    expect(headers['vary']).toBe('X-Locale, Accept-Language, X-Resolve-Locale');
    expect(headers['etag']).toBeUndefined();
    // A conditional request gets a fresh 200, never a 304 the clients would trip on.
    await api().get('/v1/store/config').set('If-None-Match', 'W/"anything"').expect(200);
  });

  it('shows a settings PATCH on the next read without waiting for the TTL', async () => {
    const before = await read();
    // The fixture may already show TTC, so flip to whichever value it is not.
    const taxDisplay = before.body.money.taxDisplay === 'TTC' ? 'HT' : 'TTC';

    await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({
        brandName: 'probe-store',
        taxDisplay,
        vatRate: 0.07,
        symbolPosition: 'after',
        baseColors: { primary: '#123456', secondary: null, accent: '#ABCDEF' },
        storefront: 'https://probe.example',
      })
      .expect(200);

    const after = await read();
    expect(after.body.identity.brandName).toBe('probe-store');
    expect(after.body.money).toMatchObject({
      taxDisplay,
      vatRate: 0.07,
      symbolPosition: 'after',
    });
    expect(after.body.brand.baseColors).toEqual({
      primary: '#123456',
      secondary: null,
      accent: '#ABCDEF',
    });
    expect(after.body.domains.storefront).toBe('https://probe.example');
  });

  it('shows a locales PATCH on the next read, RTL set included', async () => {
    await api()
      .patch('/v1/admin/settings/locales')
      .set('Cookie', adminCookie)
      .send({ supportedLocales: ['fr', 'en', 'ar'], defaultLocale: 'fr' })
      .expect(200);
    await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ rtlLocales: ['ar'] })
      .expect(200);

    const { body } = await read();
    expect(body.localization).toMatchObject({
      supportedLocales: ['fr', 'en', 'ar'],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
    });
  });

  it('refuses an RTL locale outside the supported set', async () => {
    const res = await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ rtlLocales: ['de'] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses equal money separators', async () => {
    await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ decimalSeparator: ',', thousandsSeparator: ',' })
      .expect(400);
  });
});
