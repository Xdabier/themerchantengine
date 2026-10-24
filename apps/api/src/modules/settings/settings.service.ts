import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { currencyEntry } from '@common/constants/currencies.constants';
import { isCatalogueLocale, registryLocaleCodes } from '@common/locale';
import { PrismaService } from '../../prisma/prisma.service';
import { STORE_CONFIG, type StoreConfig } from './store.config';
import {
  KEY_TO_GROUP,
  SETTINGS_GROUPS,
  SETTINGS_KEYS,
  validateSettingKey,
  type SettingsGroup,
} from './settings.constants';
import { STORE_CONFIG_UPDATED_EVENT, type StoreConfigUpdatedPayload } from './settings.events';
import type { UpdateSettingsDto } from './dto';

const CURRENCY_CONFIG_KEY = 'currencyConfig';
const SUPPORTED_LOCALES_KEY = 'supportedLocales';
const RTL_LOCALES_KEY = 'rtlLocales';
const DECIMAL_SEPARATOR_KEY = 'decimalSeparator';
const THOUSANDS_SEPARATOR_KEY = 'thousandsSeparator';

/**
 * Manages store-wide configuration with DB overrides.
 *
 * Provides a two-tier lookup: database values take precedence over defaults in store.config.ts.
 * All settings are organized into groups (general, localization, checkout, etc.).
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional so the unit suites that build the service with Prisma alone
    // keep working; production wiring always has the emitter.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * Tell every cache derived from the runtime config that it is stale.
   * Fire-and-forget: a listener failure must never fail the write.
   */
  emitStoreConfigUpdated(groups: string[]): void {
    const payload: StoreConfigUpdatedPayload = { groups };
    this.events?.emit(STORE_CONFIG_UPDATED_EVENT, payload);
  }

  // ── Retrieval ──────────────────────────────────────────────────────────────

  /**
   * Returns default configuration.
   * Used as fallback when a setting is not found in the database.
   */
  getDefaults(): StoreConfig {
    return STORE_CONFIG;
  }

  /**
   * Retrieves a single setting value by key.
   *
   * 1. Looks up the key's group from KEY_TO_GROUP
   * 2. Queries DB for (group, key)
   * 3. Falls back to default if not found
   *
   * @param key Setting key (e.g., "supportedLocales")
   * @returns The setting value or its default
   */
  async get<T = unknown>(key: string): Promise<T> {
    const group = KEY_TO_GROUP[key];
    if (!group) {
      this.logger.warn({ msg: 'Unknown setting key', key });
      return undefined as T;
    }

    try {
      const dbValue = await this.prisma.storeSetting.findUnique({
        where: { group_key: { group, key } },
        select: { value: true },
      });

      if (dbValue) {
        return dbValue.value as T;
      }
    } catch (err) {
      this.logger.error({ msg: 'Failed to fetch setting from DB', key, group, err });
    }

    // Fall back to defaults
    const defaults = STORE_CONFIG[group as SettingsGroup] as Record<string, unknown>;
    return (defaults[key] as T) ?? (undefined as T);
  }

  /**
   * Retrieves all settings in a group, merged with defaults.
   *
   * Database values override defaults. Missing keys are filled from defaults.
   *
   * @param group Settings group (e.g., "localization")
   * @returns Record of all keys in the group with their values
   */
  async getGroup(group: SettingsGroup): Promise<Record<string, unknown>> {
    const keys = SETTINGS_KEYS[group];
    if (!keys) {
      return {};
    }

    // Fetch all DB entries for this group
    const dbEntries = await this.prisma.storeSetting.findMany({
      where: { group },
      select: { key: true, value: true },
    });

    const dbMap = new Map(dbEntries.map((e) => [e.key, e.value]));

    // Merge with defaults
    const defaults = STORE_CONFIG[group] as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      result[key] = dbMap.has(key) ? dbMap.get(key) : defaults[key];
    }

    return result;
  }

  /**
   * Retrieves all settings organized by group.
   *
   * @returns Record<group, Record<key, value>>
   */
  async getAllGrouped(): Promise<Record<string, Record<string, unknown>>> {
    const result: Record<string, Record<string, unknown>> = {};

    for (const group of Object.values(SETTINGS_GROUPS)) {
      // The license verdict has its own permission and endpoint (license:view,
      // GET /v1/admin/license); settings:view must not be a second door to it.
      if (group === SETTINGS_GROUPS.LICENSE) continue;
      result[group] = await this.getGroup(group as SettingsGroup);
    }

    return result;
  }

  // ── Updates ────────────────────────────────────────────────────────────────

  /**
   * Updates a single setting in the database.
   * Creates or updates the StoreSetting record.
   *
   * @param key Setting key (must exist in SETTINGS_KEYS)
   * @param value New value
   */
  async update(key: string, value: unknown): Promise<void> {
    const group = KEY_TO_GROUP[key];
    if (!group) {
      throw new Error(`Unknown setting key: ${key}`);
    }

    validateSettingKey(key, group);

    // Same clobber guard as updateMany: a partial currencyConfig must not
    // erase the store's symbol / decimalPlaces through this door either.
    const completed =
      key === CURRENCY_CONFIG_KEY ? await this.completeCurrencyConfig(value) : value;
    await this.assertConsistent([[key, completed]]);
    const jsonValue = completed as Prisma.InputJsonValue;

    await this.prisma.storeSetting.upsert({
      where: { group_key: { group, key } },
      create: { group, key, value: jsonValue },
      update: { value: jsonValue },
    });

    this.logger.log({ msg: 'Setting updated', key, group });
    this.emitStoreConfigUpdated([group]);
  }

  /**
   * Bulk update multiple settings from a DTO.
   * Only updates keys that are present in the DTO (partial update).
   *
   * @param dto Settings update DTO with key-value pairs
   */
  async updateMany(dto: UpdateSettingsDto): Promise<void> {
    await this.upsertKeys(dto as Record<string, unknown>);
  }

  /**
   * The write path behind `updateMany`, open to any registered key rather
   * than the PATCH DTO's fields, for the callers that write a whole runtime
   * config at once (the composer's `applyStoreConfig`, the CLI seed). Keys
   * the registry does not know are skipped with a warning, never written.
   */
  async upsertKeys(entries: Record<string, unknown>): Promise<void> {
    const updates: Array<[string, unknown]> = [];

    // Collect non-undefined values
    for (const [key, value] of Object.entries(entries)) {
      if (value !== undefined) {
        const group = KEY_TO_GROUP[key];
        if (!group) {
          this.logger.warn({ msg: 'Skipping unknown setting key in update', key });
          continue;
        }
        validateSettingKey(key, group);
        if (group === SETTINGS_GROUPS.LICENSE) {
          // Only the license module writes its verdict, through writeLicenseVerdict.
          throw new BadRequestException({
            error: {
              code: 'SETTINGS_KEY_READ_ONLY',
              message: `${key} is written by the license verification, not through settings`,
            },
          });
        }
        updates.push([key, value]);
      }
    }

    if (updates.length === 0) {
      return; // Nothing to update
    }

    // The upsert below replaces the whole JSON value, so a `{ code }`-only
    // currencyConfig patch would wipe the store's symbol and decimalPlaces.
    // Complete the missing halves before writing.
    for (const update of updates) {
      if (update[0] === CURRENCY_CONFIG_KEY) {
        update[1] = await this.completeCurrencyConfig(update[1]);
      }
    }
    await this.assertConsistent(updates);

    // One transaction: a whole-config write (the composer, the CLI seed)
    // must land entirely or not at all, never half a locale set.
    await this.prisma.$transaction(
      updates.map(([key, value]) => {
        const group = KEY_TO_GROUP[key]!;
        const jsonValue = value as Prisma.InputJsonValue;
        return this.prisma.storeSetting.upsert({
          where: { group_key: { group, key } },
          create: { group, key, value: jsonValue },
          update: { value: jsonValue },
        });
      }),
    );

    this.logger.log({
      msg: 'Multiple settings updated',
      count: updates.length,
      keys: updates.map(([k]) => k),
    });
    this.emitStoreConfigUpdated([...new Set(updates.map(([key]) => KEY_TO_GROUP[key]!))]);
  }

  /**
   * The license module's own writer. Bypasses the PATCH surface and the
   * `store-config.updated` fan-out on purpose: a verdict is not a config
   * change, and every boot writes one, so an event here would flush the money
   * caches and poke the storefront revalidate hook on every restart.
   */
  async writeLicenseVerdict(verdict: {
    status: string;
    claims: unknown;
    verifiedAt: string;
  }): Promise<void> {
    const group = SETTINGS_GROUPS.LICENSE;
    const rows: Array<[string, Prisma.InputJsonValue | typeof Prisma.JsonNull]> = [
      ['status', verdict.status],
      ['claims', (verdict.claims ?? Prisma.JsonNull) as Prisma.InputJsonValue],
      ['verifiedAt', verdict.verifiedAt],
    ];
    await this.prisma.$transaction(
      rows.map(([key, value]) =>
        this.prisma.storeSetting.upsert({
          where: { group_key: { group, key } },
          create: { group, key, value },
          update: { value },
        }),
      ),
    );
  }

  /** The stored verdict, for the license module to compare against before writing. */
  async readLicenseVerdict(): Promise<{ status: unknown; claims: unknown }> {
    const group = await this.getGroup(SETTINGS_GROUPS.LICENSE);
    return { status: group['status'], claims: group['claims'] };
  }

  /**
   * Cross-key rules a per-field decorator cannot express, checked against the
   * patch merged over the stored value so a key arriving alone is still held
   * to the rule: the RTL set stays inside the supported set, the default
   * locale stays inside the supported set, and the two money separators differ.
   */
  private async assertConsistent(updates: ReadonlyArray<[string, unknown]>): Promise<void> {
    const patch = new Map(updates);
    const touches = (...keys: string[]): boolean => keys.some((key) => patch.has(key));
    const effective = async <T>(key: string): Promise<T> =>
      patch.has(key) ? (patch.get(key) as T) : this.get<T>(key);

    if (touches(SUPPORTED_LOCALES_KEY, RTL_LOCALES_KEY, 'defaultLocale')) {
      const supported = (await effective<string[]>(SUPPORTED_LOCALES_KEY)) ?? [];
      const rtl = (await effective<string[]>(RTL_LOCALES_KEY)) ?? [];
      const defaultLocale = await effective<string>('defaultLocale');
      const foreign = supported.filter((locale) => !isCatalogueLocale(locale));
      if (foreign.length > 0) {
        throw new BadRequestException({
          error: {
            code: 'SETTINGS_LOCALE_NOT_IN_CATALOGUE',
            message: `the engine ships no strings for ${foreign.join(', ')} (registry: ${registryLocaleCodes().join(', ')})`,
          },
        });
      }
      const outside = rtl.filter((locale) => !supported.includes(locale));
      if (outside.length > 0) {
        throw new BadRequestException({
          error: {
            code: 'SETTINGS_RTL_LOCALE_UNSUPPORTED',
            message: `rtlLocales must be a subset of supportedLocales (${outside.join(', ')})`,
          },
        });
      }
      if (defaultLocale && !supported.includes(defaultLocale)) {
        throw new BadRequestException({
          error: {
            code: 'SETTINGS_DEFAULT_LOCALE_UNSUPPORTED',
            message: 'defaultLocale must be one of the supportedLocales',
          },
        });
      }
    }

    if (touches(DECIMAL_SEPARATOR_KEY, THOUSANDS_SEPARATOR_KEY)) {
      const decimal = await effective<string>(DECIMAL_SEPARATOR_KEY);
      const thousands = await effective<string>(THOUSANDS_SEPARATOR_KEY);
      if (decimal === thousands) {
        throw new BadRequestException({
          error: {
            code: 'SETTINGS_MONEY_SEPARATORS_EQUAL',
            message: 'decimalSeparator and thousandsSeparator must differ',
          },
        });
      }
    }
  }

  /**
   * Fill a partial `currencyConfig` patch so it is never written half-empty.
   *
   * Precedence per field: the patch, then the catalogue entry for the patched
   * code, then the currently stored value when the code is unchanged, then a
   * two-decimal / code-as-symbol default. A patch without a code keeps the
   * stored one (the DTO requires it, so this only guards direct service calls).
   *
   * Anything that is not a plain object is rejected rather than passed through:
   * the admin reads this row on every screen, so storing an array or a null
   * there breaks every consumer that expects `{ code, symbol, decimalPlaces }`.
   * `decimalPlaces` is clamped to the ISO range for the same reason — a wild
   * value makes `Intl.NumberFormat` throw wherever money renders.
   */
  private async completeCurrencyConfig(value: unknown): Promise<unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException({
        error: {
          code: 'SETTINGS_CURRENCY_CONFIG_INVALID',
          message: 'currencyConfig must be an object with a `code`',
        },
      });
    }

    const patch = value as { code?: unknown; symbol?: unknown; decimalPlaces?: unknown };
    const stored = await this.get<{
      code?: string;
      symbol?: string;
      decimalPlaces?: number;
    }>(CURRENCY_CONFIG_KEY);

    const code = typeof patch.code === 'string' && patch.code ? patch.code : stored?.code;
    if (!code) {
      throw new BadRequestException({
        error: {
          code: 'SETTINGS_CURRENCY_CONFIG_INVALID',
          message: 'currencyConfig must be an object with a `code`',
        },
      });
    }

    const entry = currencyEntry(code);
    const keepsStored = stored?.code === code;
    const patchedDecimals =
      typeof patch.decimalPlaces === 'number' && Number.isInteger(patch.decimalPlaces)
        ? Math.min(Math.max(patch.decimalPlaces, 0), 3)
        : undefined;

    return {
      code,
      symbol:
        (typeof patch.symbol === 'string' && patch.symbol ? patch.symbol.slice(0, 8) : undefined) ??
        entry?.symbol ??
        (keepsStored ? stored?.symbol : undefined) ??
        code,
      decimalPlaces:
        patchedDecimals ??
        entry?.decimalPlaces ??
        (keepsStored ? stored?.decimalPlaces : undefined) ??
        2,
    };
  }

  /**
   * Specialized update for locales to ensure consistency.
   * Updates both supportedLocales and defaultLocale together.
   *
   * @param supportedLocales Array of supported locale codes
   * @param defaultLocale Default locale when Accept-Language is unavailable
   * @param rtlLocales Right-to-left locales; the stored set is kept when omitted
   */
  async updateLocales(
    supportedLocales: string[],
    defaultLocale: string,
    rtlLocales?: string[],
  ): Promise<void> {
    // Validate: defaultLocale must be in supportedLocales
    if (!supportedLocales.includes(defaultLocale)) {
      throw new BadRequestException('defaultLocale must be one of the supportedLocales');
    }
    await this.assertConsistent([
      [SUPPORTED_LOCALES_KEY, supportedLocales],
      ['defaultLocale', defaultLocale],
      ...(rtlLocales ? [[RTL_LOCALES_KEY, rtlLocales] as [string, unknown]] : []),
    ]);

    const group = SETTINGS_GROUPS.LOCALIZATION;

    // One transaction: a default locale outside the supported set must never
    // be observable, even for the duration of a failed second write.
    await this.prisma.$transaction([
      this.prisma.storeSetting.upsert({
        where: { group_key: { group, key: 'supportedLocales' } },
        create: { group, key: 'supportedLocales', value: supportedLocales },
        update: { value: supportedLocales },
      }),
      this.prisma.storeSetting.upsert({
        where: { group_key: { group, key: 'defaultLocale' } },
        create: { group, key: 'defaultLocale', value: defaultLocale },
        update: { value: defaultLocale },
      }),
      ...(rtlLocales
        ? [
            this.prisma.storeSetting.upsert({
              where: { group_key: { group, key: RTL_LOCALES_KEY } },
              create: { group, key: RTL_LOCALES_KEY, value: rtlLocales },
              update: { value: rtlLocales },
            }),
          ]
        : []),
    ]);

    this.logger.log({
      msg: 'Locales updated',
      supportedLocales,
      defaultLocale,
      rtlLocales,
    });
    this.emitStoreConfigUpdated([group]);
  }

  /**
   * The locale set of the store: supported, default and right-to-left.
   * `rtlLocales` is clipped to the supported set on read so a row left behind
   * by a narrowing PATCH can never mark an unsupported locale as RTL.
   */
  async getLocaleSet(): Promise<{
    supportedLocales: string[];
    defaultLocale: string;
    rtlLocales: string[];
    timezone: string;
  }> {
    const [{ supportedLocales, defaultLocale }, rtl, timezone] = await Promise.all([
      this.getLocales(),
      this.get<string[]>(RTL_LOCALES_KEY),
      this.get<string>('timezone'),
    ]);
    const rtlLocales = (Array.isArray(rtl) ? rtl : []).filter((locale) =>
      supportedLocales.includes(locale),
    );
    return {
      supportedLocales,
      defaultLocale,
      rtlLocales,
      timezone: typeof timezone === 'string' && timezone ? timezone : 'UTC',
    };
  }

  /**
   * Get supported locales and default locale together.
   * Merged from DB and defaults.
   */
  async getLocales(): Promise<{ supportedLocales: string[]; defaultLocale: string }> {
    const [supportedLocales, defaultLocale] = await Promise.all([
      this.get<string[]>('supportedLocales'),
      this.get<string>('defaultLocale'),
    ]);

    return {
      supportedLocales: supportedLocales ?? [],
      defaultLocale: defaultLocale ?? '',
    };
  }
}
