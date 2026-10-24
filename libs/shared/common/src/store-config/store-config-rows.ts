import type { StoreRuntimeConfig } from '../store-config-fixtures/store-config-fixture.schema';

/**
 * The one mapping from the runtime store config to the `StoreSetting` rows
 * that hold it (plan E1.1). Read by the seed (`prisma/seeds/store-config-fixture.ts`),
 * by the CLI stepper and by `StoreConfigComposer.applyStoreConfig` in the API,
 * so a key can only ever live in one row.
 *
 * Pure: no Prisma, no Nest, no filesystem, because the seed runs in the slim
 * production image that ships no `apps/api` source.
 */
export interface StoreSettingRow {
  group: string;
  key: string;
  value: unknown;
}

/**
 * The currencies module keeps the store currency in its own rows, outside the
 * settings registry. `GET /v1/store/config` reads `storefront.defaultCurrency`
 * for the code and only takes symbol and precision from
 * `localization.currencyConfig` when the codes agree, so a config write has
 * to produce both.
 */
export const CURRENCY_ROWS = {
  group: 'storefront',
  enabledKey: 'enabledCurrencies',
  defaultKey: 'defaultCurrency',
} as const;

export function storeConfigSettingRows(config: StoreRuntimeConfig): StoreSettingRow[] {
  const { identity, brand, localization, money, domains } = config;
  const locales = localization.supportedLocales;
  const sameInEveryLocale = (value: string): Record<string, string> =>
    Object.fromEntries([['default', value], ...locales.map((locale) => [locale, value])]);

  return [
    { group: 'general', key: 'storeName', value: identity.storeName },
    { group: 'general', key: 'contactEmail', value: identity.contact.email },
    { group: 'general', key: 'phone', value: identity.contact.phone },
    { group: 'general', key: 'address', value: identity.address.street },

    { group: 'identity', key: 'brandName', value: identity.brandName },
    { group: 'identity', key: 'description', value: identity.description },

    { group: 'brand', key: 'baseColors', value: brand.baseColors },
    { group: 'brand', key: 'fontKit', value: brand.fontKit },
    { group: 'brand', key: 'logoAssetId', value: brand.logoAssetId },
    { group: 'brand', key: 'faviconAssetId', value: brand.faviconAssetId },

    { group: 'localization', key: 'supportedLocales', value: [...locales] },
    { group: 'localization', key: 'defaultLocale', value: localization.defaultLocale },
    { group: 'localization', key: 'rtlLocales', value: [...localization.rtlLocales] },
    { group: 'localization', key: 'timezone', value: localization.timezone },
    {
      group: 'localization',
      key: 'currencyConfig',
      value: {
        code: money.currencyCode,
        symbol: money.symbol,
        decimalPlaces: money.displayPrecision,
      },
    },
    { group: CURRENCY_ROWS.group, key: CURRENCY_ROWS.defaultKey, value: money.currencyCode },
    { group: CURRENCY_ROWS.group, key: CURRENCY_ROWS.enabledKey, value: [money.currencyCode] },

    { group: 'money', key: 'symbolPosition', value: money.symbolPosition },
    { group: 'money', key: 'decimalSeparator', value: money.decimalSeparator },
    { group: 'money', key: 'thousandsSeparator', value: money.thousandsSeparator },
    { group: 'money', key: 'taxDisplay', value: money.taxDisplay },
    { group: 'money', key: 'vatRate', value: money.vatRate },

    { group: 'domains', key: 'storefront', value: domains.storefront },
    { group: 'domains', key: 'admin', value: domains.admin },
    { group: 'domains', key: 'api', value: domains.api },

    { group: 'business', key: 'legalName', value: identity.legalName },
    { group: 'business', key: 'tradingName', value: sameInEveryLocale(identity.brandName) },
    { group: 'business', key: 'streetAddress', value: identity.address.street },
    { group: 'business', key: 'addressLocality', value: identity.address.locality },
    { group: 'business', key: 'addressRegion', value: identity.address.region },
    { group: 'business', key: 'postalCode', value: identity.address.postalCode ?? '' },
    { group: 'business', key: 'addressCountry', value: identity.address.country },
    { group: 'business', key: 'telephone', value: identity.contact.phone },
    { group: 'business', key: 'areaServed', value: [...identity.areaServed] },
    { group: 'business', key: 'businessType', value: identity.businessType },
  ];
}
