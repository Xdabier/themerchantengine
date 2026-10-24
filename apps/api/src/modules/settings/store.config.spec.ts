import { LOCALE_CATALOGUE, STORE_CONFIG } from './store.config';
import { SETTINGS_GROUPS, SETTINGS_KEYS } from './settings.constants';

/**
 * The neutrality gate (DR-31, plan E1.1).
 *
 * DR-29 put a launch gate here that held every tenant value to being exactly
 * the client's value, because `settings.service.ts` merges DB rows over code
 * defaults silently and a forgotten row publishes whatever the code says. The
 * engine is now brandless, so the rule inverts: every default must be a
 * neutral value that names no client, no real domain, no country and no
 * currency choice. The same silent merge is why this matters more, not less:
 * a client value left in a default would ship to every store that never set
 * the row.
 *
 * The assertion is on the flattened leaves of the whole config, not on a
 * hand-picked list, so a new key with a client value fails the day it lands.
 */

/** Anything that names or anchors to a client the engine was extracted from. */
// Bracketed first letters so this file does not trip the guard it mirrors
// (`scripts/verify-no-client-refs.ts` scans source text).
const CLIENT_ANCHORS = [
  /[d]ents/i,
  /al[-\s]?[k]haleej/i,
  /\b[Q]AR\b/,
  /\b[T]ND\b/,
  /[T]unis/i,
  /[Q]atar/i,
  /\b[D]oha\b/i,
  /\+974/,
  /\+216/,
  /^(TN|QA)$/,
];

function flatten(value: unknown, path: string): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => flatten(entry, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, `${path}.${k}`),
    );
  }
  return [[path, value]];
}

const leaves = flatten(STORE_CONFIG, 'STORE_CONFIG');
const business = STORE_CONFIG.business as Record<string, unknown>;

describe('store config neutrality gate', () => {
  it('has leaves to check, so the sweep cannot pass by looking at nothing', () => {
    expect(leaves.length).toBeGreaterThan(40);
    const paths = leaves.map(([path]) => path);
    expect(paths).toContain('STORE_CONFIG.general.storeName.default');
    expect(paths).toContain('STORE_CONFIG.business.addressCountry');
    expect(paths).toContain('STORE_CONFIG.localization.currencyConfig.code');
    expect(paths).toContain('STORE_CONFIG.domains.storefront');
  });

  for (const anchor of CLIENT_ANCHORS) {
    it(`no default matches ${anchor}`, () => {
      const hits = leaves.filter(([, leaf]) => typeof leaf === 'string' && anchor.test(leaf));
      expect(hits).toEqual([]);
    });
  }

  it('names no real domain anywhere', () => {
    const hits = leaves.filter(
      ([, leaf]) => typeof leaf === 'string' && /https?:\/\/|\.(tn|store|com|net)\b/i.test(leaf),
    );
    expect(hits).toEqual([]);
  });

  describe('every tenant identity value is empty', () => {
    const pending = [
      'legalName',
      'tradingName',
      'streetAddress',
      'addressLocality',
      'addressRegion',
      'postalCode',
      'addressCountry',
      'geoLat',
      'geoLng',
      'telephone',
      'taxRegistrationNumber',
    ] as const;

    for (const key of pending) {
      it(`business.${key} is empty`, () => {
        const value = business[key];
        expect(value).toBeDefined();
        if (value === null) return;
        for (const [path, leaf] of flatten(value, `business.${key}`)) {
          expect(`${path}=${String(leaf)}`).toBe(`${path}=`);
        }
      });
    }

    it('business.areaServed is empty', () => {
      expect(business['areaServed']).toEqual([]);
    });

    it('identity.description and general contact fields are empty', () => {
      expect(STORE_CONFIG.identity.description).toEqual({ default: '', ar: '', fr: '', en: '' });
      expect(STORE_CONFIG.general.contactEmail).toBe('');
      expect(STORE_CONFIG.general.phone).toBe('');
    });

    it('domains are empty so the environment variables stay the source', () => {
      expect(STORE_CONFIG.domains).toEqual({ storefront: '', admin: '', api: '' });
    });

    it('the license starts as missing with no claims', () => {
      expect(STORE_CONFIG.license).toEqual({ claims: null, status: 'missing', verifiedAt: null });
    });
  });

  describe('the neutral values are internally consistent', () => {
    it('supported locales are drawn from the catalogue and include the default', () => {
      const supported = [...STORE_CONFIG.localization.supportedLocales];
      for (const locale of supported) {
        expect(LOCALE_CATALOGUE).toContain(locale);
      }
      expect(supported).toContain(STORE_CONFIG.localization.defaultLocale);
    });

    it('rtl locales are a subset of the supported set', () => {
      for (const locale of STORE_CONFIG.localization.rtlLocales) {
        expect([...STORE_CONFIG.localization.supportedLocales]).toContain(locale);
      }
    });

    it('every neutral Translatable carries every supported locale', () => {
      const translatables = leaves
        .map(([path]) => path)
        .filter((path) => path.endsWith('.default'))
        .map((path) => path.slice(0, -'.default'.length));
      expect(translatables.length).toBeGreaterThan(3);
      const paths = new Set(leaves.map(([path]) => path));
      for (const base of translatables) {
        for (const locale of STORE_CONFIG.localization.supportedLocales) {
          expect(paths.has(`${base}.${locale}`)).toBe(true);
        }
      }
    });

    it('money separators differ and the precision matches the currency', () => {
      expect(STORE_CONFIG.money.decimalSeparator).not.toBe(STORE_CONFIG.money.thousandsSeparator);
      expect(STORE_CONFIG.localization.currencyConfig.decimalPlaces).toBeGreaterThanOrEqual(0);
      expect(STORE_CONFIG.localization.currencyConfig.decimalPlaces).toBeLessThanOrEqual(3);
      expect(['before', 'after']).toContain(STORE_CONFIG.money.symbolPosition);
      expect(['HT', 'TTC', 'none']).toContain(STORE_CONFIG.money.taxDisplay);
      expect(STORE_CONFIG.money.vatRate).toBe(0);
    });

    it('the brand primary colour is a six-digit hex and the font kit covers Arabic and Latin', () => {
      expect(STORE_CONFIG.brand.baseColors.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(STORE_CONFIG.brand.fontKit).toBe('arabic-latin');
    });

    it('priceRange is a member of the schema.org enum', () => {
      expect(['$', '$$', '$$$']).toContain(business['priceRange']);
    });
  });

  describe('the key registry and the defaults agree', () => {
    for (const group of Object.values(SETTINGS_GROUPS)) {
      it(`every registered key of ${group} has a default, and every default is registered`, () => {
        const defaults = Object.keys(STORE_CONFIG[group as keyof typeof STORE_CONFIG]);
        const registered = [...SETTINGS_KEYS[group as keyof typeof SETTINGS_KEYS]];
        expect(defaults.sort()).toEqual(registered.sort());
      });
    }
  });
});
