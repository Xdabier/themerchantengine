import type { StoreRuntimeConfig } from '../store-config-fixtures/store-config-fixture.schema';
import { NEUTRAL_LOCALE_SET } from '../locale/store-locales';
import { NEUTRAL_MONEY } from '../money/store-money';

/**
 * The runtime config a fresh engine runs on before anyone configures it
 * (DR-31): every value neutral, nothing that names a client, a country
 * or a real domain. The API's `STORE_CONFIG` defaults compose to exactly this
 * (pinned by `store-config.composer.spec.ts`), and the seed reads it when no
 * scenario fixture is selected, so the two paths cannot drift.
 */
export const NEUTRAL_STORE_CONFIG: StoreRuntimeConfig = Object.freeze({
  identity: {
    storeName: { default: 'My Store', ar: 'My Store', fr: 'My Store', en: 'My Store' },
    brandName: 'store',
    description: { default: '', ar: '', fr: '', en: '' },
    legalName: { default: '', ar: '', fr: '', en: '' },
    contact: { email: '', phone: '' },
    address: {
      street: { default: '', ar: '', fr: '', en: '' },
      locality: '',
      region: '',
      postalCode: null,
      country: '',
    },
    areaServed: [],
    businessType: 'OnlineStore',
  },
  brand: {
    baseColors: { primary: '#1F2937', secondary: null, accent: null },
    fontKit: 'arabic-latin',
    logoAssetId: null,
    faviconAssetId: null,
  },
  localization: {
    supportedLocales: [
      ...NEUTRAL_LOCALE_SET.supportedLocales,
    ] as StoreRuntimeConfig['localization']['supportedLocales'],
    defaultLocale:
      NEUTRAL_LOCALE_SET.defaultLocale as StoreRuntimeConfig['localization']['defaultLocale'],
    rtlLocales: [
      ...NEUTRAL_LOCALE_SET.rtlLocales,
    ] as StoreRuntimeConfig['localization']['rtlLocales'],
    timezone: NEUTRAL_LOCALE_SET.timezone,
  },
  money: { ...NEUTRAL_MONEY },
  domains: { storefront: '', admin: '', api: '' },
});
