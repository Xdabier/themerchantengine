/**
 * Static ISO 4217 currency catalogue. Top-20-ish — covers GCC + EUR +
 * major reserves. Adding a currency is a code change so the allow-list
 * stays tight.
 *
 * `decimalPlaces` matches the ISO table — JOD/KWD/BHD are 3 digits, JPY
 * is 0. The admin UI passes this to Intl.NumberFormat.
 *
 * Lives in the shared lib rather than the currencies module because two
 * modules read it: `currencies` (enabled set, default, store currency) and
 * `settings` (completing a partial `currencyConfig` patch). Importing it
 * from the currencies module into settings would close a module cycle,
 * since currencies already injects SettingsService.
 */
export interface CurrencyEntry {
  code: string;
  symbol: string;
  name: string;
  decimalPlaces: number;
  region: string;
}

export const CURRENCIES: readonly CurrencyEntry[] = [
  // MENA — the store currency first, since it is the one the engine runs on.
  // `symbol` is `DT` rather than `د.ت` per brand-floor §3.2: the charte writes
  // the symbol after the number in a Latin-script LTR page, and an Arabic
  // symbol there is the only right-to-left run on the screen.
  { code: 'TND', symbol: 'DT', name: 'Tunisian Dinar', decimalPlaces: 3, region: 'MENA' },
  { code: 'LYD', symbol: 'LD', name: 'Libyan Dinar', decimalPlaces: 3, region: 'MENA' },

  // GCC
  { code: 'QAR', symbol: 'ر.ق', name: 'Qatari Riyal', decimalPlaces: 2, region: 'GCC' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', decimalPlaces: 2, region: 'GCC' },
  { code: 'SAR', symbol: 'ر.س', name: 'Saudi Riyal', decimalPlaces: 2, region: 'GCC' },
  { code: 'KWD', symbol: 'د.ك', name: 'Kuwaiti Dinar', decimalPlaces: 3, region: 'GCC' },
  { code: 'BHD', symbol: 'د.ب', name: 'Bahraini Dinar', decimalPlaces: 3, region: 'GCC' },
  { code: 'OMR', symbol: 'ر.ع.', name: 'Omani Rial', decimalPlaces: 3, region: 'GCC' },

  // MENA
  { code: 'EGP', symbol: 'ج.م', name: 'Egyptian Pound', decimalPlaces: 2, region: 'MENA' },
  { code: 'JOD', symbol: 'د.أ', name: 'Jordanian Dinar', decimalPlaces: 3, region: 'MENA' },

  // Europe
  { code: 'EUR', symbol: '€', name: 'Euro', decimalPlaces: 2, region: 'Europe' },
  { code: 'GBP', symbol: '£', name: 'Pound Sterling', decimalPlaces: 2, region: 'Europe' },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc', decimalPlaces: 2, region: 'Europe' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', decimalPlaces: 2, region: 'Europe' },

  // Americas
  { code: 'USD', symbol: '$', name: 'US Dollar', decimalPlaces: 2, region: 'Americas' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar', decimalPlaces: 2, region: 'Americas' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', decimalPlaces: 2, region: 'Americas' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', decimalPlaces: 2, region: 'Americas' },

  // Asia-Pacific
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', decimalPlaces: 0, region: 'Asia-Pacific' },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese Yuan', decimalPlaces: 2, region: 'Asia-Pacific' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', decimalPlaces: 2, region: 'Asia-Pacific' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', decimalPlaces: 2, region: 'Asia-Pacific' },
  {
    code: 'AUD',
    symbol: 'A$',
    name: 'Australian Dollar',
    decimalPlaces: 2,
    region: 'Asia-Pacific',
  },
];

export const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

/** The catalogue entry for a code, or undefined for a code outside the allow-list. */
export function currencyEntry(code: string): CurrencyEntry | undefined {
  return CURRENCIES.find((c) => c.code === code);
}
