/**
 * Scenario store configs reach the public surface (plan E0.4, DR-31).
 *
 * The three e2e harnesses seed StoreSetting from the fixture named by
 * STORE_CONFIG_FIXTURE through the same seeder this spec calls. What a unit
 * test cannot reach is whether the rows it writes are the rows the public
 * config endpoint reads, so this spec seeds each fixture against the real
 * database and reads it back through `GET /v1/storefront/config`.
 *
 * Every row it touches is restored in teardown: the settings are global and a
 * leftover Arabic store name would change what every other suite renders.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { loadStoreConfigFixture, type StoreConfigFixtureId } from '@common/store-config-fixtures';
import {
  seedStoreConfigFixture,
  storeConfigFixtureSettingRows,
} from '../../prisma/seeds/store-config-fixture';
import { api, createTestPrisma, flushRedisKeys } from './helpers';

interface PublicConfig {
  identity: { storeName: unknown };
  currency: { code: string; symbol: string; decimalPlaces: number };
  locales: { supportedLocales: string[]; defaultLocale: string };
}

interface RuntimeConfig {
  identity: { storeName: unknown; brandName: string; address: { country: string } };
  brand: { fontKit: string };
  localization: { supportedLocales: string[]; defaultLocale: string; rtlLocales: string[] };
  money: { currencyCode: string; symbol: string; displayPrecision: number; taxDisplay: string };
  domains: { storefront: string };
}

const CACHE_PATTERN = 'store*:config';

/** The E1.2 endpoint, read raw so the Translatable fields keep every locale. */
async function readRuntimeConfig(): Promise<RuntimeConfig> {
  await flushRedisKeys(CACHE_PATTERN);
  const res = await api().get('/v1/store/config').set('X-Resolve-Locale', 'false').expect(200);
  return res.body.data as RuntimeConfig;
}

async function readConfig(acceptLanguage: string): Promise<PublicConfig> {
  await flushRedisKeys(CACHE_PATTERN);
  const res = await api()
    .get('/v1/storefront/config')
    .set('Accept-Language', acceptLanguage)
    .expect(200);
  return res.body.data as PublicConfig;
}

describe('store config fixtures reach GET /v1/storefront/config', () => {
  let prisma: PrismaClient;
  const touched = new Map<string, Prisma.JsonValue | null>();

  beforeAll(async () => {
    prisma = createTestPrisma();
    // Capture every row any fixture writes, so teardown can put it back.
    const ids: StoreConfigFixtureId[] = ['gulf-rtl', 'maghreb-ltr'];
    for (const id of ids) {
      for (const row of storeConfigFixtureSettingRows(loadStoreConfigFixture(id))) {
        const mapKey = `${row.group}/${row.key}`;
        if (touched.has(mapKey)) continue;
        const existing = await prisma.storeSetting.findUnique({
          where: { group_key: { group: row.group, key: row.key } },
          select: { value: true },
        });
        touched.set(mapKey, existing ? existing.value : null);
      }
    }
  });

  afterAll(async () => {
    for (const [mapKey, value] of touched) {
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
    // Only the config cache: nothing here reads a price. A later assertion on
    // money must also flush the keys prisma/flush-money-cache.ts lists.
    await flushRedisKeys(CACHE_PATTERN);
    await prisma.$disconnect();
  });

  it('gulf-rtl: Arabic default, AED with two decimals, English store name under en', async () => {
    const gulf = loadStoreConfigFixture('gulf-rtl');
    const written = await seedStoreConfigFixture(prisma, gulf);
    expect(written).toBe(storeConfigFixtureSettingRows(gulf).length);

    const config = await readConfig('en');
    expect(config.locales).toEqual({ supportedLocales: ['ar', 'en'], defaultLocale: 'ar' });
    expect(config.currency).toEqual({ code: 'AED', symbol: 'د.إ', decimalPlaces: 2 });
    expect(config.identity.storeName).toBe('Marsa Market');

    const arabic = await readConfig('ar');
    expect(arabic.locales.defaultLocale).toBe('ar');
    // Rows written by Prisma do not refresh the interceptor's locale snapshot;
    // locale-spine.e2e-spec.ts covers the Arabic read through the admin endpoints.

    // The E1.1 groups the older endpoint has no slot for reach the runtime config.
    const runtime = await readRuntimeConfig();
    expect(runtime.identity.storeName).toEqual(gulf.identity.storeName);
    expect(runtime.identity.brandName).toBe(gulf.identity.brandName);
    expect(runtime.identity.address.country).toBe(gulf.identity.address.country);
    expect(runtime.brand.fontKit).toBe('arabic-latin');
    expect(runtime.localization).toEqual(gulf.localization);
    expect(runtime.money).toMatchObject({
      currencyCode: 'AED',
      displayPrecision: 2,
      taxDisplay: gulf.money.taxDisplay,
    });
    expect(runtime.domains.storefront).toBe(gulf.domains.storefront);
  });

  it('maghreb-ltr: French default, LYD with three decimals, French store name under fr', async () => {
    await seedStoreConfigFixture(prisma, loadStoreConfigFixture('maghreb-ltr'));

    const config = await readConfig('fr');
    expect(config.locales).toEqual({ supportedLocales: ['fr', 'en'], defaultLocale: 'fr' });
    expect(config.currency).toEqual({ code: 'LYD', symbol: 'LD', decimalPlaces: 3 });
    expect(config.identity.storeName).toBe('Atlas Fournitures');

    const english = await readConfig('en');
    expect(english.identity.storeName).toBe('Atlas Supplies');

    const runtime = await readRuntimeConfig();
    expect(runtime.localization.rtlLocales).toEqual([]);
    expect(runtime.money).toMatchObject({
      currencyCode: 'LYD',
      symbol: 'LD',
      displayPrecision: 3,
      taxDisplay: 'HT',
    });
  });
});
