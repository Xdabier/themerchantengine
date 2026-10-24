import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import {
  STORE_CONFIG_BUSINESS_TYPES,
  STORE_CONFIG_FONT_KITS,
  STORE_CONFIG_LOCALES,
  STORE_CONFIG_SYMBOL_POSITIONS,
  STORE_CONFIG_TAX_DISPLAYS,
  type StoreRuntimeConfig,
  storeRuntimeConfigSchema,
} from '@common/store-config-fixtures/store-config-fixture.schema';
import { CURRENCY_ROWS, storeConfigSettingRows } from '@common/store-config';
import { generatePalette, type GeneratedPalette } from '@common/brand';
import { MONEY_CACHE_KEY_PATTERNS } from '@common/money';
import { CurrenciesService } from '../currencies/currencies.service';
import { SettingsService } from '../settings/settings.service';
import { SETTINGS_GROUPS } from '../settings/settings.constants';
import {
  STORE_CONFIG_UPDATED_EVENT,
  type StoreConfigUpdatedPayload,
} from '../settings/settings.events';
import { STORE_CONFIG } from '../settings/store.config';
import {
  STORE_CONFIG_CACHE_KEY,
  STOREFRONT_CONFIG_REDIS_CLIENT,
  STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
  STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS,
} from './storefront-config.constants';

type Group = Record<string, unknown>;
type Translatable = { default: string } & Record<string, string>;

const DOMAIN_ENV = {
  storefront: 'STOREFRONT_PUBLIC_BASE_URL',
  admin: 'ADMIN_PUBLIC_BASE_URL',
  api: 'API_PUBLIC_BASE_URL',
} as const;

/**
 * Composes the runtime store config (DR-31, plan E1.1) from the settings
 * groups and the currencies module, in the shape `storeRuntimeConfigSchema`
 * declares, and writes one back through the same two services.
 *
 * The groups are the storage shape and stay flat because the admin edits them
 * key by key; this class is the only place that knows how they join. The
 * reverse mapping is the shared `storeConfigSettingRows`, so the seed, the
 * CLI and this class write the same rows.
 *
 * Cached in Redis for a minute and dropped on `store-config.updated`, which
 * every settings and currencies write emits, so a PATCH is visible on the
 * next read and the TTL only covers a write that bypassed the services.
 */
@Injectable()
export class StoreConfigComposer {
  private readonly logger = new Logger(StoreConfigComposer.name);

  constructor(
    @Inject(STOREFRONT_CONFIG_REDIS_CLIENT) private readonly redis: Redis,
    private readonly settings: SettingsService,
    private readonly currencies: CurrenciesService,
    private readonly config: ConfigService,
  ) {}

  async getStoreConfig(): Promise<StoreRuntimeConfig> {
    const cached = await this.tryGetCache();
    if (cached) return cached;

    const [general, identity, brand, localization, money, domains, business, currency, locales] =
      await Promise.all([
        this.settings.getGroup(SETTINGS_GROUPS.GENERAL),
        this.settings.getGroup(SETTINGS_GROUPS.IDENTITY),
        this.settings.getGroup(SETTINGS_GROUPS.BRAND),
        this.settings.getGroup(SETTINGS_GROUPS.LOCALIZATION),
        this.settings.getGroup(SETTINGS_GROUPS.MONEY),
        this.settings.getGroup(SETTINGS_GROUPS.DOMAINS),
        this.settings.getGroup(SETTINGS_GROUPS.BUSINESS),
        this.currencies.getStore(),
        this.settings.getLocaleSet(),
      ]);

    const colors = baseColors(brand['baseColors']);

    const composed: StoreRuntimeConfig = {
      identity: {
        storeName: translatable(general['storeName'], STORE_CONFIG.general.storeName),
        brandName: str(identity['brandName'], STORE_CONFIG.identity.brandName),
        description: translatable(identity['description'], STORE_CONFIG.identity.description),
        legalName: translatable(business['legalName'], STORE_CONFIG.business.legalName),
        contact: {
          email: str(general['contactEmail'], ''),
          phone: e164OrEmpty(general['phone']),
        },
        address: {
          street: translatable(business['streetAddress'], STORE_CONFIG.business.streetAddress),
          locality: str(business['addressLocality'], ''),
          region: str(business['addressRegion'], ''),
          postalCode: str(business['postalCode'], '') || null,
          country: str(business['addressCountry'], ''),
        },
        areaServed: stringList(business['areaServed']),
        businessType: oneOf(business['businessType'], STORE_CONFIG_BUSINESS_TYPES, 'OnlineStore'),
      },
      brand: {
        baseColors: colors,
        fontKit: oneOf(brand['fontKit'], STORE_CONFIG_FONT_KITS, STORE_CONFIG.brand.fontKit),
        logoAssetId: nullableStr(brand['logoAssetId']),
        faviconAssetId: nullableStr(brand['faviconAssetId']),
        generatedPalette: this.palette(colors),
      },
      localization: {
        supportedLocales: locales.supportedLocales.filter(isCatalogueLocale),
        defaultLocale: isCatalogueLocale(locales.defaultLocale)
          ? locales.defaultLocale
          : STORE_CONFIG_LOCALES[0],
        rtlLocales: locales.rtlLocales.filter(isCatalogueLocale),
        timezone: validTimezone(localization['timezone']) ?? STORE_CONFIG.localization.timezone,
      },
      money: {
        currencyCode: currency.code,
        symbol: currency.symbol,
        symbolPosition: oneOf(
          money['symbolPosition'],
          STORE_CONFIG_SYMBOL_POSITIONS,
          STORE_CONFIG.money.symbolPosition,
        ),
        decimalSeparator: str(money['decimalSeparator'], STORE_CONFIG.money.decimalSeparator),
        thousandsSeparator: str(money['thousandsSeparator'], STORE_CONFIG.money.thousandsSeparator),
        displayPrecision: Math.min(Math.max(currency.decimalPlaces, 0), 3),
        taxDisplay: oneOf(
          money['taxDisplay'],
          STORE_CONFIG_TAX_DISPLAYS,
          STORE_CONFIG.money.taxDisplay,
        ),
        vatRate: num(money['vatRate'], STORE_CONFIG.money.vatRate),
      },
      domains: {
        storefront: this.domain(domains, 'storefront'),
        admin: this.domain(domains, 'admin'),
        api: this.domain(domains, 'api'),
      },
    };

    // The wire contract is the admin's and the storefront's parse boundary; a
    // row the PATCH bounds let through must never become a client-side throw.
    const checked = storeRuntimeConfigSchema.safeParse(composed);
    if (!checked.success) {
      this.logger.error(
        `Composed store config fails its own contract: ${checked.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    await this.trySetCache(composed);
    return composed;
  }

  /**
   * Writes a whole config: the currencies roster first, because its writer
   * mirrors the catalogue symbol into `currencyConfig`, then every settings
   * row so the configured symbol and precision win.
   */
  async applyStoreConfig(config: StoreRuntimeConfig): Promise<void> {
    await this.currencies.update({
      enabled: [config.money.currencyCode],
      defaultCode: config.money.currencyCode,
    });
    const entries: Record<string, unknown> = {};
    for (const row of storeConfigSettingRows(config)) {
      if (row.group === CURRENCY_ROWS.group) continue;
      entries[row.key] = row.value;
    }
    await this.settings.upsertKeys(entries);
    await this.invalidate();
  }

  /**
   * A row wins over the environment variable; both empty means empty. The
   * variable is held to the same origin shape as the row, so a malformed or
   * internal value in the environment never reaches the public payload.
   */
  private domain(rows: Group, key: keyof typeof DOMAIN_ENV): string {
    const row = str(rows[key], '');
    if (row) return row;
    const fromEnv = (this.config.get<string>(DOMAIN_ENV[key]) ?? '').replace(/\/+$/, '');
    return PUBLIC_ORIGIN.test(fromEnv) ? fromEnv : '';
  }

  @OnEvent(STORE_CONFIG_UPDATED_EVENT, { async: true })
  async onStoreConfigUpdated(payload?: StoreConfigUpdatedPayload): Promise<void> {
    await this.invalidate(touchesMoney(payload?.groups));
  }

  /**
   * Drops the two config keys and every keyspace that caches money (plan
   * E1.4.4): a currency or tax change reaches the storefront prices, the feed
   * and llms.txt on the next read rather than at the end of their TTLs. SCAN
   * rather than KEYS, so a large product cache never blocks the server.
   */
  private async invalidate(flushMoney = true): Promise<void> {
    try {
      await this.redis.del(STORE_CONFIG_CACHE_KEY, STOREFRONT_PUBLIC_CONFIG_CACHE_KEY);
      if (!flushMoney) return;
      for (const pattern of MONEY_CACHE_KEY_PATTERNS) {
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 250);
          cursor = next;
          if (keys.length > 0) await this.redis.del(...keys);
        } while (cursor !== '0');
      }
    } catch (err) {
      this.logger.warn(`Cache invalidation failed: ${(err as Error).message}`);
    }
  }

  /**
   * Expand the stored base colours into the token set the storefront renders
   * (plan E2.1). Derived on every compose rather than stored on write, so the
   * palette cannot drift from the colours it came from; the Redis cache in
   * front of this method means it runs once per invalidation, not per request.
   *
   * A palette the generator refuses is logged and omitted rather than thrown.
   * The colours reached the settings row through validation that should have
   * caught it, so a refusal here is a bug upstream, and taking every storefront
   * page down over a colour is worse than serving the config without a palette
   * and letting the committed fallback tokens stand.
   */
  private palette(colors: StoreRuntimeConfig['brand']['baseColors']): GeneratedPalette | undefined {
    try {
      return generatePalette(colors);
    } catch (err) {
      this.logger.error(`Palette generation failed: ${(err as Error).message}`);
      return undefined;
    }
  }

  private async tryGetCache(): Promise<StoreRuntimeConfig | null> {
    try {
      const value = await this.redis.get(STORE_CONFIG_CACHE_KEY);
      return value ? (JSON.parse(value) as StoreRuntimeConfig) : null;
    } catch (err) {
      this.logger.warn(
        `Cache GET failed for "${STORE_CONFIG_CACHE_KEY}": ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async trySetCache(value: StoreRuntimeConfig): Promise<void> {
    try {
      await this.redis.set(
        STORE_CONFIG_CACHE_KEY,
        JSON.stringify(value),
        'EX',
        STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Cache SET failed for "${STORE_CONFIG_CACHE_KEY}": ${(err as Error).message}`,
      );
    }
  }
}

/** Settings groups whose rows reach a price, a rate or a currency somewhere. */
const MONEY_BEARING_GROUPS = new Set([
  SETTINGS_GROUPS.MONEY,
  SETTINGS_GROUPS.LOCALIZATION,
  SETTINGS_GROUPS.BUSINESS,
  SETTINGS_GROUPS.IDENTITY,
  SETTINGS_GROUPS.GENERAL,
  'storefront',
]);

/** An event that names its groups flushes the money caches only when one of them bears money. */
function touchesMoney(groups: readonly string[] | undefined): boolean {
  if (!groups || groups.length === 0) return true;
  return groups.some((group) => MONEY_BEARING_GROUPS.has(group));
}

/** The same origin shape the settings row is held to. */
const PUBLIC_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/i;

function e164OrEmpty(value: unknown): string {
  if (typeof value !== 'string') return '';
  const compact = value.replace(/[\s.()-]/g, '');
  return /^\+[1-9][0-9]{6,14}$/.test(compact) ? compact : '';
}

function validTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return /^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$|^UTC$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

// ── Tolerant readers: a StoreSetting row is untyped JSON ─────────────────────

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function isCatalogueLocale(value: string): value is (typeof STORE_CONFIG_LOCALES)[number] {
  return (STORE_CONFIG_LOCALES as readonly string[]).includes(value);
}

function translatable(value: unknown, fallback: Readonly<Translatable>): Translatable {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
      if (typeof text === 'string') out[key] = text;
    }
    if (typeof out['default'] === 'string') return out as Translatable;
  }
  return { ...fallback };
}

function baseColors(value: unknown): StoreRuntimeConfig['brand']['baseColors'] {
  const fallback = STORE_CONFIG.brand.baseColors;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  const raw = value as Record<string, unknown>;
  const hex = (v: unknown): string | null =>
    typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v) ? v : null;
  return {
    primary: hex(raw['primary']) ?? fallback.primary,
    secondary: hex(raw['secondary']),
    accent: hex(raw['accent']),
  };
}
