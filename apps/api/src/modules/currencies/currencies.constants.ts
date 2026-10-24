/**
 * The currency catalogue moved to `libs/shared/common/src/constants` so the
 * settings module can complete a partial `currencyConfig` patch without
 * importing from this module (which would close a cycle — currencies injects
 * SettingsService). Re-exported here so existing imports keep working.
 */
export {
  CURRENCIES,
  CURRENCY_CODES,
  currencyEntry,
  type CurrencyEntry,
} from '@common/constants/currencies.constants';
