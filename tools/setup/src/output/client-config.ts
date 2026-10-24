import {
  storeRuntimeConfigSchema,
  type StoreRuntimeConfig,
} from '../../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import { NEUTRAL_STORE_CONFIG } from '../../../../libs/shared/common/src/store-config/neutral-store-config';
import type { SetupAnswers } from '../answers';

/**
 * `client.config.json` (plan E4.2): the runtime store config the seed writes
 * into `StoreSetting` through the shared row mapping. It is exactly the shape
 * `GET /v1/store/config` serves and the scenario fixtures carry, parsed by the
 * same strict schema, so a key the stepper misspells fails here rather than
 * seeding a row nothing reads.
 */
export const CLIENT_CONFIG_FILE = 'client.config.json';

export class ClientConfigError extends Error {}

function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new ClientConfigError(`${what} was never answered; run the stepper again`);
  }
  return value;
}

/** A Translatable with `default` and one key per supported locale, filled from what was answered. */
export function translatableFor(
  value: Record<string, string> | undefined,
  locales: readonly string[],
  defaultLocale: string,
): Record<string, string> & { default: string } {
  const given = value ?? {};
  const fallback = given['default'] ?? given[defaultLocale] ?? Object.values(given)[0] ?? '';
  const out: Record<string, string> & { default: string } = {
    default: given['default'] ?? fallback,
  };
  for (const locale of locales) out[locale] = given[locale] ?? fallback;
  return out;
}

export function buildStoreConfig(answers: SetupAnswers): StoreRuntimeConfig {
  const identity = answers.identity ?? {};
  const brand = answers.brand ?? {};
  const localization = answers.localization ?? {};
  const money = answers.money ?? {};
  const domains = answers.domains ?? {};
  const locales = required(localization.supportedLocales, 'localization.supportedLocales');
  const defaultLocale = required(localization.defaultLocale, 'localization.defaultLocale');
  const t = (value: Record<string, string> | undefined) =>
    translatableFor(value, locales, defaultLocale);

  const candidate: StoreRuntimeConfig = {
    identity: {
      storeName: t(identity.storeName),
      brandName: required(identity.brandName, 'identity.brandName'),
      description: t(identity.description),
      legalName: t(identity.legalName),
      contact: {
        email: identity.contactEmail ?? '',
        phone: identity.contactPhone ?? '',
      },
      address: {
        street: t(identity.street),
        locality: identity.locality ?? '',
        region: identity.region ?? '',
        postalCode: identity.postalCode ?? null,
        country: required(identity.country, 'identity.country'),
      },
      areaServed: identity.areaServed ?? [required(identity.country, 'identity.country')],
      businessType: identity.businessType ?? NEUTRAL_STORE_CONFIG.identity.businessType,
    },
    brand: {
      baseColors: {
        primary: required(brand.primary, 'brand.primary'),
        secondary: brand.secondary ?? null,
        accent: brand.accent ?? null,
      },
      fontKit: brand.fontKit ?? NEUTRAL_STORE_CONFIG.brand.fontKit,
      logoAssetId: null,
      faviconAssetId: null,
    },
    localization: {
      supportedLocales: locales,
      defaultLocale,
      rtlLocales: localization.rtlLocales ?? [],
      timezone: localization.timezone ?? NEUTRAL_STORE_CONFIG.localization.timezone,
    },
    money: {
      currencyCode: required(money.currencyCode, 'money.currencyCode'),
      symbol: required(money.symbol, 'money.symbol'),
      symbolPosition: money.symbolPosition ?? NEUTRAL_STORE_CONFIG.money.symbolPosition,
      decimalSeparator: money.decimalSeparator ?? NEUTRAL_STORE_CONFIG.money.decimalSeparator,
      thousandsSeparator: money.thousandsSeparator ?? NEUTRAL_STORE_CONFIG.money.thousandsSeparator,
      displayPrecision: money.displayPrecision ?? NEUTRAL_STORE_CONFIG.money.displayPrecision,
      taxDisplay: money.taxDisplay ?? NEUTRAL_STORE_CONFIG.money.taxDisplay,
      vatRate: money.vatRate ?? 0,
    },
    domains: {
      storefront: required(domains.storefront, 'domains.storefront'),
      admin: required(domains.admin, 'domains.admin'),
      api: required(domains.api, 'domains.api'),
    },
  };

  const parsed = storeRuntimeConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ClientConfigError(`${issue.path.join('.')}: ${issue.message}`);
  }
  return parsed.data;
}

export function serializeStoreConfig(config: StoreRuntimeConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
