/**
 * Static ISO 3166-1 alpha-2 country catalogue for the admin UI. Subset
 * sized for readability — covers the markets the spec expects operators
 * to turn on at checkout. Region groupings are display-only; the
 * storefront never reads them.
 *
 * When a country is missing here, a future release can extend the list
 * without a migration because enabled/default are persisted per code
 * (not a FK to this table).
 */
export interface CountryEntry {
  code: string;
  name: string;
  region: string;
  emoji: string;
}

export const COUNTRIES: readonly CountryEntry[] = [
  // GCC
  { code: 'QA', name: 'Qatar', region: 'GCC', emoji: '🇶🇦' },
  { code: 'AE', name: 'United Arab Emirates', region: 'GCC', emoji: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', region: 'GCC', emoji: '🇸🇦' },
  { code: 'KW', name: 'Kuwait', region: 'GCC', emoji: '🇰🇼' },
  { code: 'BH', name: 'Bahrain', region: 'GCC', emoji: '🇧🇭' },
  { code: 'OM', name: 'Oman', region: 'GCC', emoji: '🇴🇲' },

  // MENA (non-GCC)
  { code: 'EG', name: 'Egypt', region: 'MENA', emoji: '🇪🇬' },
  { code: 'JO', name: 'Jordan', region: 'MENA', emoji: '🇯🇴' },
  { code: 'LB', name: 'Lebanon', region: 'MENA', emoji: '🇱🇧' },
  { code: 'MA', name: 'Morocco', region: 'MENA', emoji: '🇲🇦' },
  { code: 'LY', name: 'Libya', region: 'MENA', emoji: '🇱🇾' },
  { code: 'TN', name: 'Tunisia', region: 'MENA', emoji: '🇹🇳' },

  // Europe
  { code: 'GB', name: 'United Kingdom', region: 'Europe', emoji: '🇬🇧' },
  { code: 'DE', name: 'Germany', region: 'Europe', emoji: '🇩🇪' },
  { code: 'FR', name: 'France', region: 'Europe', emoji: '🇫🇷' },
  { code: 'IT', name: 'Italy', region: 'Europe', emoji: '🇮🇹' },
  { code: 'ES', name: 'Spain', region: 'Europe', emoji: '🇪🇸' },
  { code: 'NL', name: 'Netherlands', region: 'Europe', emoji: '🇳🇱' },
  { code: 'SE', name: 'Sweden', region: 'Europe', emoji: '🇸🇪' },

  // Americas
  { code: 'US', name: 'United States', region: 'Americas', emoji: '🇺🇸' },
  { code: 'CA', name: 'Canada', region: 'Americas', emoji: '🇨🇦' },
  { code: 'MX', name: 'Mexico', region: 'Americas', emoji: '🇲🇽' },
  { code: 'BR', name: 'Brazil', region: 'Americas', emoji: '🇧🇷' },

  // Asia-Pacific
  { code: 'IN', name: 'India', region: 'Asia-Pacific', emoji: '🇮🇳' },
  { code: 'PK', name: 'Pakistan', region: 'Asia-Pacific', emoji: '🇵🇰' },
  { code: 'ID', name: 'Indonesia', region: 'Asia-Pacific', emoji: '🇮🇩' },
  { code: 'MY', name: 'Malaysia', region: 'Asia-Pacific', emoji: '🇲🇾' },
  { code: 'SG', name: 'Singapore', region: 'Asia-Pacific', emoji: '🇸🇬' },
  { code: 'AU', name: 'Australia', region: 'Asia-Pacific', emoji: '🇦🇺' },
  { code: 'JP', name: 'Japan', region: 'Asia-Pacific', emoji: '🇯🇵' },
  { code: 'KR', name: 'South Korea', region: 'Asia-Pacific', emoji: '🇰🇷' },
];

export const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));
