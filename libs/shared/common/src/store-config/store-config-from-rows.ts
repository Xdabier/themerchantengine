import type { StoreRuntimeConfig } from '../store-config-fixtures/store-config-fixture.schema';
import { NEUTRAL_STORE_CONFIG } from './neutral-store-config';
import { CURRENCY_ROWS, type StoreSettingRow } from './store-config-rows';

/**
 * The inverse of `storeConfigSettingRows`: the runtime config a database
 * already holds, read back from its `StoreSetting` rows (plan E1.4, security
 * review C1). The seed uses it on every deploy so that a store that was
 * configured through the stepper or the admin is seeded against ITS config,
 * never against the neutral one, which would retire its zones and rates.
 *
 * Every field falls back to the neutral value when the row is absent or
 * malformed, so a fresh database reads as the neutral config exactly.
 */
export function storeConfigFromSettingRows(
  rows: readonly StoreSettingRow[],
  fallback: StoreRuntimeConfig = NEUTRAL_STORE_CONFIG,
): StoreRuntimeConfig {
  const byKey = new Map<string, unknown>();
  for (const row of rows) byKey.set(`${row.group}.${row.key}`, row.value);
  const str = (key: string, dflt: string): string => {
    const v = byKey.get(key);
    return typeof v === 'string' ? v : dflt;
  };
  const strList = (key: string, dflt: readonly string[]): string[] => {
    const v = byKey.get(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [...dflt];
  };
  const translatable = (key: string, dflt: Record<string, string>): Record<string, string> => {
    const v = byKey.get(key);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
        if (typeof t === 'string') out[k] = t;
      }
      if (typeof out['default'] === 'string') return out;
    }
    return { ...dflt };
  };
  const num = (key: string, dflt: number): number => {
    const v = byKey.get(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  };
  const nullableStr = (key: string): string | null => {
    const v = byKey.get(key);
    return typeof v === 'string' && v ? v : null;
  };

  const currencyConfig = byKey.get('localization.currencyConfig') as
    | { code?: unknown; symbol?: unknown; decimalPlaces?: unknown }
    | undefined;
  const currencyCode =
    str(`${CURRENCY_ROWS.group}.${CURRENCY_ROWS.defaultKey}`, '') ||
    (typeof currencyConfig?.code === 'string' ? currencyConfig.code : fallback.money.currencyCode);
  const codesAgree = currencyConfig?.code === currencyCode;
  const baseColorsRaw = byKey.get('brand.baseColors') as Record<string, unknown> | undefined;
  const hex = (v: unknown): string | null =>
    typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v) ? v : null;

  const config = {
    identity: {
      storeName: translatable('general.storeName', fallback.identity.storeName),
      brandName: str('identity.brandName', fallback.identity.brandName),
      description: translatable('identity.description', fallback.identity.description),
      legalName: translatable('business.legalName', fallback.identity.legalName),
      contact: {
        email: str('general.contactEmail', fallback.identity.contact.email),
        phone: str('general.phone', fallback.identity.contact.phone),
      },
      address: {
        street: translatable('business.streetAddress', fallback.identity.address.street),
        locality: str('business.addressLocality', fallback.identity.address.locality),
        region: str('business.addressRegion', fallback.identity.address.region),
        postalCode: nullableStr('business.postalCode'),
        country: str('business.addressCountry', fallback.identity.address.country),
      },
      areaServed: strList('business.areaServed', fallback.identity.areaServed),
      businessType: str('business.businessType', fallback.identity.businessType),
    },
    brand: {
      baseColors: {
        primary: hex(baseColorsRaw?.['primary']) ?? fallback.brand.baseColors.primary,
        secondary: hex(baseColorsRaw?.['secondary']),
        accent: hex(baseColorsRaw?.['accent']),
      },
      fontKit: str('brand.fontKit', fallback.brand.fontKit),
      logoAssetId: nullableStr('brand.logoAssetId'),
      faviconAssetId: nullableStr('brand.faviconAssetId'),
    },
    localization: {
      supportedLocales: strList(
        'localization.supportedLocales',
        fallback.localization.supportedLocales,
      ),
      defaultLocale: str('localization.defaultLocale', fallback.localization.defaultLocale),
      rtlLocales: strList('localization.rtlLocales', fallback.localization.rtlLocales),
      timezone: str('localization.timezone', fallback.localization.timezone),
    },
    money: {
      currencyCode,
      symbol:
        codesAgree && typeof currencyConfig?.symbol === 'string' && currencyConfig.symbol
          ? currencyConfig.symbol
          : fallback.money.symbol,
      symbolPosition: str('money.symbolPosition', fallback.money.symbolPosition),
      decimalSeparator: str('money.decimalSeparator', fallback.money.decimalSeparator),
      thousandsSeparator: str('money.thousandsSeparator', fallback.money.thousandsSeparator),
      displayPrecision:
        codesAgree && typeof currencyConfig?.decimalPlaces === 'number'
          ? currencyConfig.decimalPlaces
          : fallback.money.displayPrecision,
      taxDisplay: str('money.taxDisplay', fallback.money.taxDisplay),
      vatRate: num('money.vatRate', fallback.money.vatRate),
    },
    domains: {
      storefront: str('domains.storefront', fallback.domains.storefront),
      admin: str('domains.admin', fallback.domains.admin),
      api: str('domains.api', fallback.domains.api),
    },
  };
  return config as StoreRuntimeConfig;
}

/** True when the rows describe a configured store: a country, or a served area. */
export function isConfiguredStore(config: StoreRuntimeConfig): boolean {
  return config.identity.address.country !== '' || config.identity.areaServed.length > 0;
}
