import type { BadgeTone } from '@admin-ui';
import type { ShippingMethodType } from '@admin-services';
import { formatMoney, type MoneyCurrency } from '../../shared/format/money';

/**
 * ISO-3166-1 alpha-2 codes supported as country allowlist entries. Mirrors the
 * backend's `@IsArray + @IsString` shape (no custom ISO validator); we enforce
 * the well-known set client-side so operators can't persist typos.
 */
export const ISO_COUNTRY_CODES: readonly string[] = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
] as const;

const ISO_SET = new Set(ISO_COUNTRY_CODES);
export function isIsoCountry(code: string): boolean {
  return ISO_SET.has(code.toUpperCase());
}

export const METHOD_TYPE_LABELS: Record<ShippingMethodType, string> = {
  FLAT_RATE: 'Flat rate',
  WEIGHT_BASED: 'Weight based',
  PRICE_BASED: 'Price based',
  CARRIER_CALCULATED: 'Carrier calculated',
  FREE: 'Free',
};

export function methodTypeBadgeTone(type: ShippingMethodType): BadgeTone {
  switch (type) {
    case 'FREE':
      return 'success';
    case 'FLAT_RATE':
      return 'info';
    case 'WEIGHT_BASED':
    case 'PRICE_BASED':
      return 'neutral';
    case 'CARRIER_CALCULATED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function translatableDefault(value: { default?: string } | null | undefined): string {
  return typeof value?.default === 'string' ? value.default : '';
}

export function countriesPreview(countries: readonly string[]): string {
  if (countries.length === 0) return '—';
  const head = countries.slice(0, 5).join(', ');
  return countries.length > 5 ? `${head} +${countries.length - 5}` : head;
}

export function statesSummary(states: readonly string[] | null | undefined): string {
  if (!states || states.length === 0) return '—';
  return `${states.length}`;
}

/**
 * `currency` is required and has no default. Shipping methods carry no
 * per-record currency, so callers pass the store currency. The hardcoded
 * default this replaced was a guess, and it also rendered the wrong way round:
 * amount before code instead of the canonical code before amount.
 */
export function methodPriceSummary(
  method: {
    type: ShippingMethodType;
    price?: number | null;
  },
  currency: MoneyCurrency,
): string {
  if (method.type === 'FREE') return 'Free';
  if (method.type === 'FLAT_RATE') {
    return typeof method.price === 'number' ? formatMoney(method.price, currency) : '—';
  }
  return '—';
}

/**
 * Free-shipping threshold formatted like the Price column (2-decimal money with
 * the store currency), instead of the raw coerced number. Em-dash when unset.
 */
export function freeAboveSummary(
  freeAbove: number | null | undefined,
  currency: MoneyCurrency,
): string {
  return typeof freeAbove === 'number' ? formatMoney(freeAbove, currency) : '—';
}
