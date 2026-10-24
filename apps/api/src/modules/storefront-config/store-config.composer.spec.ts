import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  STORE_CONFIG_FIXTURE_IDS,
  loadStoreConfigFixture,
  runtimeConfigOfFixture,
  storeRuntimeConfigSchema,
  type StoreRuntimeConfig,
} from '@common/store-config-fixtures';
import { CURRENCY_ROWS, NEUTRAL_STORE_CONFIG, storeConfigSettingRows } from '@common/store-config';
import { MONEY_CACHE_KEY_PATTERNS } from '@common/money';
import { BRAND_TOKEN_KEYS, generatePalette } from '@common/brand';
import { currencyEntry } from '@common/constants/currencies.constants';
import { CurrenciesService } from '../currencies/currencies.service';
import { SettingsService } from '../settings/settings.service';
import { STORE_CONFIG } from '../settings/store.config';
import { SETTINGS_KEYS } from '../settings/settings.constants';
import { StoreConfigComposer } from './store-config.composer';
import {
  STORE_CONFIG_CACHE_KEY,
  STOREFRONT_CONFIG_REDIS_CLIENT,
  STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
} from './storefront-config.constants';

/**
 * A settings service backed by an in-memory row map, so the round trip
 * "apply a fixture, compose it back" exercises the real key registry rather
 * than a hand-written mock per group.
 */
function fakeSettings(rows: Map<string, unknown>) {
  const groupOf = (key: string): string | undefined =>
    Object.entries(SETTINGS_KEYS).find(([, keys]) =>
      (keys as readonly string[]).includes(key),
    )?.[0];
  return {
    getGroup: jest.fn(async (group: string) => {
      const defaults = (STORE_CONFIG as Record<string, Record<string, unknown>>)[group] ?? {};
      const out: Record<string, unknown> = {};
      for (const key of (SETTINGS_KEYS as Record<string, readonly string[]>)[group] ?? []) {
        out[key] = rows.has(`${group}.${key}`) ? rows.get(`${group}.${key}`) : defaults[key];
      }
      return out;
    }),
    getLocaleSet: jest.fn(async () => {
      const loc = rows;
      const supported = (loc.get('localization.supportedLocales') as string[] | undefined) ?? [
        ...STORE_CONFIG.localization.supportedLocales,
      ];
      const rtl = (loc.get('localization.rtlLocales') as string[] | undefined) ?? [
        ...STORE_CONFIG.localization.rtlLocales,
      ];
      return {
        supportedLocales: supported,
        defaultLocale:
          (loc.get('localization.defaultLocale') as string | undefined) ??
          STORE_CONFIG.localization.defaultLocale,
        rtlLocales: rtl.filter((l) => supported.includes(l)),
        timezone: (loc.get('localization.timezone') as string | undefined) ?? 'UTC',
      };
    }),
    upsertKeys: jest.fn(async (entries: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(entries)) {
        const group = groupOf(key);
        if (group) rows.set(`${group}.${key}`, value);
      }
    }),
    get: jest.fn(async (key: string) => rows.get(`${groupOf(key)}.${key}`)),
  };
}

function fakeCurrencies(rows: Map<string, unknown>) {
  return {
    getStore: jest.fn(async () => {
      const code =
        (rows.get(`${CURRENCY_ROWS.group}.${CURRENCY_ROWS.defaultKey}`) as string) ?? 'USD';
      const cfg = rows.get('localization.currencyConfig') as
        | { code: string; symbol: string; decimalPlaces: number }
        | undefined;
      const agrees = cfg?.code === code;
      // Mirrors CurrenciesService.getStore: the stored config when its code
      // agrees, else the catalogue entry, else the code itself.
      const entry = currencyEntry(code);
      return {
        code,
        symbol: (agrees ? cfg!.symbol : undefined) ?? entry?.symbol ?? code,
        decimalPlaces: (agrees ? cfg!.decimalPlaces : undefined) ?? entry?.decimalPlaces ?? 2,
        enabled: [code],
      };
    }),
    update: jest.fn(async (dto: { enabled: string[]; defaultCode?: string }) => {
      rows.set(`${CURRENCY_ROWS.group}.${CURRENCY_ROWS.enabledKey}`, dto.enabled);
      if (dto.defaultCode)
        rows.set(`${CURRENCY_ROWS.group}.${CURRENCY_ROWS.defaultKey}`, dto.defaultCode);
    }),
  };
}

/** The stored shape, without the palette the composer derives on top of it. */
const withoutPalette = (config: StoreRuntimeConfig): StoreRuntimeConfig => ({
  ...config,
  brand: { ...config.brand, generatedPalette: undefined },
});

describe('StoreConfigComposer', () => {
  let rows: Map<string, unknown>;
  let composer: StoreConfigComposer;
  let settings: ReturnType<typeof fakeSettings>;
  let currencies: ReturnType<typeof fakeCurrencies>;
  const redis = { get: jest.fn(), set: jest.fn(), del: jest.fn(), scan: jest.fn() };
  const env: Record<string, string> = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    rows = new Map();
    settings = fakeSettings(rows);
    currencies = fakeCurrencies(rows);
    redis.get.mockResolvedValue(null);
    redis.scan.mockResolvedValue(['0', []]);
    for (const key of Object.keys(env)) delete env[key];

    const module = await Test.createTestingModule({
      providers: [
        StoreConfigComposer,
        { provide: STOREFRONT_CONFIG_REDIS_CLIENT, useValue: redis },
        { provide: SettingsService, useValue: settings },
        { provide: CurrenciesService, useValue: currencies },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
      ],
    }).compile();
    composer = module.get(StoreConfigComposer);
  });

  it('composes a neutral, schema-valid config from the bare defaults', async () => {
    const config = await composer.getStoreConfig();
    expect(storeRuntimeConfigSchema.safeParse(config).success).toBe(true);
    expect(config.identity.storeName).toEqual(STORE_CONFIG.general.storeName);
    expect(config.localization).toEqual({
      supportedLocales: ['ar', 'fr', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    expect(config.money.currencyCode).toBe('USD');
    expect(config.domains).toEqual({ storefront: '', admin: '', api: '' });
    expect(config).not.toHaveProperty('license');
    // The seed's neutral config and the API's code defaults are one shape. The
    // palette is compared separately below: it is derived here and absent from
    // the stored shape, which is the point of deriving it (plan E2.1.4).
    expect(withoutPalette(config)).toEqual(NEUTRAL_STORE_CONFIG);
  });

  it('composes the palette from the stored base colours', async () => {
    const config = await composer.getStoreConfig();
    const palette = config.brand.generatedPalette;
    expect(palette).toBeDefined();
    expect(Object.keys(palette?.tokens ?? {}).sort()).toEqual([...BRAND_TOKEN_KEYS].sort());
    expect(palette?.tokens['--brand-primary']).toBeDefined();
    expect(palette).toEqual(generatePalette(config.brand.baseColors));
  });

  it('regenerates the palette after a config update drops the cache', async () => {
    const before = (await composer.getStoreConfig()).brand.generatedPalette;

    rows.set('brand.baseColors', { primary: '#8a2f2f', secondary: null, accent: null });
    await composer.onStoreConfigUpdated();

    const after = (await composer.getStoreConfig()).brand.generatedPalette;
    expect(after).not.toEqual(before);
    expect(after?.tokens['--brand-primary']).toBe('#8a2f2f');
  });

  it.each(STORE_CONFIG_FIXTURE_IDS)(
    'round-trips the %s fixture through apply then get',
    async (id) => {
      const runtime = runtimeConfigOfFixture(loadStoreConfigFixture(id));
      await composer.applyStoreConfig(runtime);

      expect(currencies.update).toHaveBeenCalledWith({
        enabled: [runtime.money.currencyCode],
        defaultCode: runtime.money.currencyCode,
      });
      // Every non-currency row of the shared mapping went through the settings door.
      const expectedKeys = storeConfigSettingRows(runtime)
        .filter((r) => r.group !== CURRENCY_ROWS.group)
        .map((r) => r.key)
        .sort();
      expect(Object.keys(settings.upsertKeys.mock.calls[0][0]).sort()).toEqual(expectedKeys);
      expect(redis.del).toHaveBeenCalledWith(
        STORE_CONFIG_CACHE_KEY,
        STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
      );

      const composed = await composer.getStoreConfig();
      // The fixture carries the input colours, not their expansion, so the
      // round-trip compares the stored shape and the palette separately.
      expect(withoutPalette(composed)).toEqual(runtime);
      expect(composed.brand.generatedPalette).toEqual(generatePalette(runtime.brand.baseColors));
    },
  );

  it('falls back to the environment for an empty domain row', async () => {
    env['STOREFRONT_PUBLIC_BASE_URL'] = 'https://shop.example/';
    env['API_PUBLIC_BASE_URL'] = 'http://localhost:53000';
    rows.set('domains.admin', 'https://admin.example');
    const config = await composer.getStoreConfig();
    expect(config.domains).toEqual({
      storefront: 'https://shop.example',
      admin: 'https://admin.example',
      api: 'http://localhost:53000',
    });
  });

  it('tolerates malformed rows by falling back per field', async () => {
    rows.set('brand.baseColors', { primary: 'red', secondary: '#00FF00' });
    rows.set('brand.fontKit', 'comic-sans');
    rows.set('money.vatRate', '19');
    rows.set('business.areaServed', ['FR', 42, null]);
    rows.set('general.storeName', 'not a translatable');
    const config = await composer.getStoreConfig();
    expect(config.brand.baseColors).toEqual({
      primary: STORE_CONFIG.brand.baseColors.primary,
      secondary: '#00FF00',
      accent: null,
    });
    expect(config.brand.fontKit).toBe('arabic-latin');
    expect(config.money.vatRate).toBe(0);
    expect(config.identity.areaServed).toEqual(['FR']);
    expect(config.identity.storeName).toEqual(STORE_CONFIG.general.storeName);
  });

  it('serves the cached copy and repopulates it after a miss', async () => {
    const runtime = runtimeConfigOfFixture(loadStoreConfigFixture('demo'));
    redis.get.mockResolvedValueOnce(JSON.stringify(runtime));
    expect(await composer.getStoreConfig()).toEqual(runtime);
    expect(settings.getGroup).not.toHaveBeenCalled();

    redis.get.mockResolvedValueOnce(null);
    await composer.getStoreConfig();
    expect(redis.set).toHaveBeenCalledWith(STORE_CONFIG_CACHE_KEY, expect.any(String), 'EX', 60);
  });

  it('drops both config keys and every money keyspace on store-config.updated', async () => {
    redis.scan.mockResolvedValueOnce(['0', ['tax:zone:__default__', 'tax:zone:FR']]);
    await composer.onStoreConfigUpdated();
    expect(redis.del).toHaveBeenCalledWith(
      STORE_CONFIG_CACHE_KEY,
      STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
    );
    expect(redis.del).toHaveBeenCalledWith('tax:zone:__default__', 'tax:zone:FR');
    for (const pattern of MONEY_CACHE_KEY_PATTERNS) {
      expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', pattern, 'COUNT', 250);
    }
  });

  it('keeps composing when Redis is down', async () => {
    redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const config = await composer.getStoreConfig();
    expect(config.money.currencyCode).toBe('USD');
  });
});
