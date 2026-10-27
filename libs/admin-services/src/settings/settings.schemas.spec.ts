import * as fs from 'node:fs';
import * as path from 'node:path';
import { updateLocalesRequestSchema, updateSettingsRequestSchema } from './settings.schemas';

/**
 * Parity guard for `updateSettingsRequestSchema` against `UpdateSettingsDto`
 * (`apps/api/src/modules/settings/dto/update-settings.dto.ts`).
 *
 * The schema is not a formality. `SettingsService.update` parses the body
 * through it and Zod strips every key the object does not model, so a field
 * the schema has never heard of is removed from the PATCH before it is sent.
 * The service throws only when the strip empties the body completely; a body
 * that mixes one modelled key with an unmodelled one saves the modelled key,
 * drops the other and reports success. A screen built on an unmodelled field
 * therefore does not fail, it lies.
 *
 * These tests feed the exact wire shape the backend DTO accepts, key by key,
 * so the parse is exercised against the contract rather than against whatever
 * the screens happen to send today.
 */

/** Every key of `UpdateSettingsDto`, with a value that DTO accepts. */
const FULL_BODY = {
  // General
  storeName: { default: 'Demo Store', en: 'Demo Store' },
  contactEmail: 'owner@example.com',
  phone: '+21612345678',
  address: { street: '1 Main Street' },
  socialLinks: { instagram: 'https://example.com/demo' },
  // Localization
  supportedLocales: ['en', 'fr'],
  defaultLocale: 'en',
  timezone: 'Europe/Paris',
  rtlLocales: ['ar'],
  // Identity
  brandName: 'demo-store',
  description: { default: 'A demo store', en: 'A demo store' },
  // Brand
  baseColors: { primary: '#3355FF', secondary: '#101010', accent: null },
  fontKit: 'latin-rounded',
  logoAssetId: '11111111-1111-4111-8111-111111111111',
  faviconAssetId: null,
  // Money
  symbolPosition: 'after',
  decimalSeparator: ',',
  thousandsSeparator: ' ',
  taxDisplay: 'TTC',
  vatRate: 0.19,
  currencyConfig: { code: 'EUR', symbol: '€', decimalPlaces: 2 },
  // Domains
  storefront: 'https://demo.example.com',
  admin: 'https://admin.example.com',
  api: '',
  // Checkout
  guestCheckoutEnabled: true,
  minimumOrderAmount: 10,
  // Inventory
  defaultLowStockThreshold: 5,
  reservationSettings: { ttlMinutes: 30 },
  // Orders
  numberPrefix: 'ORD-',
  numberFormat: 'sequential',
  cancellationPolicy: { hours: 24 },
  // Returns
  windowDays: 14,
  requirePhotos: false,
  autoApprove: true,
  // Shipping
  defaultHandlingTime: '1-2 days',
  cutOffTime: '16:00',
  // Notifications
  pauseAll: false,
  // Business
  taxRegistrationNumber: '1234567A',
  legalName: { default: 'Demo Store SARL', en: 'Demo Store SARL' },
  tradingName: { default: 'Demo Store', en: 'Demo Store' },
  streetAddress: { default: '1 Main Street', en: '1 Main Street' },
  addressLocality: 'Paris',
  addressRegion: 'Île-de-France',
  postalCode: '75001',
  addressCountry: 'FR',
  // Appearance
  logoUrl: '/uploads/logo.png',
  faviconUrl: 'https://cdn.example.com/favicon.ico',
} as const;

describe('updateSettingsRequestSchema', () => {
  it('keeps every key the backend DTO accepts', () => {
    const parsed = updateSettingsRequestSchema.parse({ ...FULL_BODY });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(FULL_BODY).sort());
  });

  it('drops nothing when each key is sent on its own', () => {
    // A per-key loop, because the whole-body assertion above passes even if a
    // key only survives because a sibling key kept the object non-empty.
    for (const [key, value] of Object.entries(FULL_BODY)) {
      const parsed = updateSettingsRequestSchema.parse({ [key]: value });
      expect(Object.keys(parsed)).toEqual([key]);
    }
  });

  it('still strips a key the backend does not accept', () => {
    const parsed = updateSettingsRequestSchema.parse({
      contactEmail: 'owner@example.com',
      notASetting: 'x',
    } as Record<string, unknown>);
    expect(parsed).toEqual({ contactEmail: 'owner@example.com' });
  });

  /**
   * The tests above prove the keys somebody remembered to list. This one reads
   * the DTO itself, so a field added to the backend tomorrow with no schema key
   * fails here instead of failing silently on an operator's screen.
   *
   * The DTO is read as source rather than imported: it lives in `apps/api` and
   * this library must not depend on the backend at build time. A source scan is
   * the weaker tool, and it is the one that respects the boundary.
   */
  it('models every property the DTO declares, read from the DTO itself', () => {
    const dtoPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'apps',
      'api',
      'src',
      'modules',
      'settings',
      'dto',
      'update-settings.dto.ts',
    );
    const source = fs.readFileSync(dtoPath, 'utf8');
    const body = source.slice(source.indexOf('export class UpdateSettingsDto'));
    const declared = [...body.matchAll(/^\s{2}(\w+)\?:/gm)].map(([, name]) => name);

    // A scan that finds nothing would pass forever.
    expect(declared.length).toBeGreaterThan(30);

    const modelled = new Set(Object.keys(updateSettingsRequestSchema.shape));
    expect(declared.filter((name) => !modelled.has(name))).toEqual([]);
    // And the other way: a schema key the DTO does not declare is a 400 under
    // `forbidNonWhitelisted`, which is worse than a missing one.
    expect([...modelled].filter((name) => !declared.includes(name))).toEqual([]);
  });

  describe('bounds the shared schemas do not carry', () => {
    it('holds a Translatable default to the DTO length, and refuses an empty one', () => {
      expect(() =>
        updateSettingsRequestSchema.parse({ storeName: { default: 'x'.repeat(501) } }),
      ).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ storeName: { default: '' } })).toThrow();
      expect(updateSettingsRequestSchema.parse({ legalName: { default: 'Demo SARL' } })).toEqual({
        legalName: { default: 'Demo SARL' },
      });
    });

    it('holds an appearance URL to the shape the API renders into markup', () => {
      expect(() => updateSettingsRequestSchema.parse({ logoUrl: 'logo.png' })).toThrow();
      expect(() =>
        updateSettingsRequestSchema.parse({ faviconUrl: 'javascript:alert(1)' }),
      ).toThrow();
      expect(updateSettingsRequestSchema.parse({ logoUrl: '' })).toEqual({ logoUrl: '' });
      expect(updateSettingsRequestSchema.parse({ logoUrl: '/uploads/logo.png' })).toEqual({
        logoUrl: '/uploads/logo.png',
      });
    });
  });

  describe('constraints that must match the DTO', () => {
    it('caps currencyConfig.decimalPlaces at three, as Decimal(12, 3) storage does', () => {
      expect(() =>
        updateSettingsRequestSchema.parse({ currencyConfig: { code: 'TZS', decimalPlaces: 4 } }),
      ).toThrow();
      expect(
        updateSettingsRequestSchema.parse({ currencyConfig: { code: 'TZS', decimalPlaces: 3 } }),
      ).toEqual({ currencyConfig: { code: 'TZS', decimalPlaces: 3 } });
    });

    it('holds phone to E.164 with no separators, or empty', () => {
      expect(updateSettingsRequestSchema.parse({ phone: '' })).toEqual({ phone: '' });
      expect(updateSettingsRequestSchema.parse({ phone: '+21612345678' })).toEqual({
        phone: '+21612345678',
      });
      expect(() => updateSettingsRequestSchema.parse({ phone: '06 12 34 56' })).toThrow();
    });

    it('refuses a locale outside the engine catalogue', () => {
      expect(() => updateSettingsRequestSchema.parse({ defaultLocale: 'es' })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ supportedLocales: ['en', 'de'] })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ rtlLocales: ['he'] })).toThrow();
    });

    it('holds brandName to a lowercase slug', () => {
      expect(() => updateSettingsRequestSchema.parse({ brandName: 'Demo Store' })).toThrow();
      expect(updateSettingsRequestSchema.parse({ brandName: 'demo-store' })).toEqual({
        brandName: 'demo-store',
      });
    });

    it('holds every base colour to a six-digit hex, and allows a null clear', () => {
      expect(() =>
        updateSettingsRequestSchema.parse({
          baseColors: { primary: 'blue', secondary: null, accent: null },
        }),
      ).toThrow();
      expect(
        updateSettingsRequestSchema.parse({
          baseColors: { primary: '#3355FF', secondary: null, accent: null },
        }),
      ).toEqual({ baseColors: { primary: '#3355FF', secondary: null, accent: null } });
    });

    it('holds fontKit, symbolPosition and taxDisplay to their enumerations', () => {
      expect(() => updateSettingsRequestSchema.parse({ fontKit: 'serif' })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ symbolPosition: 'left' })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ taxDisplay: 'VAT' })).toThrow();
    });

    it('holds each separator to one character', () => {
      expect(() => updateSettingsRequestSchema.parse({ decimalSeparator: '' })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ thousandsSeparator: ', ' })).toThrow();
    });

    it('holds vatRate to a rate rather than a percentage', () => {
      expect(() => updateSettingsRequestSchema.parse({ vatRate: 19 })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ vatRate: -0.1 })).toThrow();
      expect(() => updateSettingsRequestSchema.parse({ vatRate: 0.123456 })).toThrow();
      expect(updateSettingsRequestSchema.parse({ vatRate: 0.19 })).toEqual({ vatRate: 0.19 });
    });

    it('holds timezone to an IANA zone or UTC', () => {
      expect(() => updateSettingsRequestSchema.parse({ timezone: 'GMT+1' })).toThrow();
      expect(updateSettingsRequestSchema.parse({ timezone: 'UTC' })).toEqual({ timezone: 'UTC' });
    });

    it('holds an asset id to a UUID, and allows a null clear', () => {
      expect(() => updateSettingsRequestSchema.parse({ logoAssetId: 'logo.png' })).toThrow();
      expect(updateSettingsRequestSchema.parse({ logoAssetId: null })).toEqual({
        logoAssetId: null,
      });
    });

    it('holds a domain to an https origin with no path, or empty', () => {
      expect(() =>
        updateSettingsRequestSchema.parse({ storefront: 'http://demo.example.com' }),
      ).toThrow();
      expect(() =>
        updateSettingsRequestSchema.parse({ admin: 'https://admin.example.com/dashboard' }),
      ).toThrow();
      // Empty is the documented "fall back to the environment variable" value.
      expect(updateSettingsRequestSchema.parse({ api: '' })).toEqual({ api: '' });
    });

    it('holds addressCountry to an ISO 3166-1 alpha-2 code, or empty', () => {
      expect(() => updateSettingsRequestSchema.parse({ addressCountry: 'France' })).toThrow();
      expect(updateSettingsRequestSchema.parse({ addressCountry: 'FR' })).toEqual({
        addressCountry: 'FR',
      });
    });
  });
});

describe('updateLocalesRequestSchema', () => {
  it('keeps the default inside the supported set', () => {
    expect(() =>
      updateLocalesRequestSchema.parse({ supportedLocales: ['en'], defaultLocale: 'fr' }),
    ).toThrow();
  });

  it('refuses a locale the engine ships no catalogue for', () => {
    expect(() =>
      updateLocalesRequestSchema.parse({ supportedLocales: ['en', 'es'], defaultLocale: 'en' }),
    ).toThrow();
  });

  it('accepts a catalogue subset', () => {
    expect(
      updateLocalesRequestSchema.parse({ supportedLocales: ['en', 'ar'], defaultLocale: 'ar' }),
    ).toEqual({ supportedLocales: ['en', 'ar'], defaultLocale: 'ar' });
  });

  it('carries the writing direction through when given', () => {
    expect(
      updateLocalesRequestSchema.parse({
        supportedLocales: ['en', 'ar'],
        defaultLocale: 'en',
        rtlLocales: ['ar'],
      }),
    ).toEqual({ supportedLocales: ['en', 'ar'], defaultLocale: 'en', rtlLocales: ['ar'] });
  });

  it('accepts an empty direction set', () => {
    expect(
      updateLocalesRequestSchema.parse({
        supportedLocales: ['en'],
        defaultLocale: 'en',
        rtlLocales: [],
      }).rtlLocales,
    ).toEqual([]);
  });

  it('keeps the direction set inside the supported set', () => {
    expect(() =>
      updateLocalesRequestSchema.parse({
        supportedLocales: ['en'],
        defaultLocale: 'en',
        rtlLocales: ['ar'],
      }),
    ).toThrow();
  });
});
