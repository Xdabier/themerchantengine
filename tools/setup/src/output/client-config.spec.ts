import { describe, expect, it } from 'vitest';
import { storeConfigSettingRows } from '../../../../libs/shared/common/src/store-config/store-config-rows';
import { storeRuntimeConfigSchema } from '../../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import type { SetupAnswers } from '../answers';
import { ClientConfigError, buildStoreConfig, translatableFor } from './client-config';

export const COMPLETE_ANSWERS: SetupAnswers = {
  profile: 'engine',
  identity: {
    storeName: { default: 'Atlas', fr: 'Atlas', en: 'Atlas' },
    brandName: 'atlas',
    description: { default: 'Shop' },
    legalName: { default: 'Atlas SAS' },
    contactEmail: 'hello@atlas.example',
    contactPhone: '+33100000000',
    street: { default: '1 Rue X' },
    locality: 'Lyon',
    region: 'ARA',
    postalCode: '69001',
    country: 'FR',
    businessType: 'OnlineStore',
  },
  domains: {
    storefront: 'https://atlas.example',
    admin: 'https://admin.atlas.example',
    api: 'https://api.atlas.example',
  },
  brand: { primary: '#1F4E79', secondary: '#F2B441', accent: null, fontKit: 'latin-rounded' },
  localization: {
    supportedLocales: ['fr', 'en'],
    defaultLocale: 'fr',
    rtlLocales: [],
    timezone: 'Europe/Paris',
  },
  money: {
    currencyCode: 'EUR',
    symbol: '€',
    symbolPosition: 'after',
    decimalSeparator: ',',
    thousandsSeparator: ' ',
    displayPrecision: 2,
    taxDisplay: 'TTC',
    vatRate: 0.2,
    shippingFlatRate: 7,
  },
};

describe('buildStoreConfig', () => {
  it('builds a config the strict runtime schema accepts and the row mapping consumes', () => {
    const config = buildStoreConfig(COMPLETE_ANSWERS);
    expect(storeRuntimeConfigSchema.safeParse(config).success).toBe(true);
    expect(config.identity.areaServed).toEqual(['FR']);
    expect(config.brand.logoAssetId).toBeNull();
    const rows = storeConfigSettingRows(config);
    expect(rows.find((r) => r.group === 'domains' && r.key === 'api')?.value).toBe(
      'https://api.atlas.example',
    );
    expect(rows.find((r) => r.group === 'money' && r.key === 'vatRate')?.value).toBe(0.2);
  });

  it('fills every supported locale of a Translatable from what was answered', () => {
    expect(translatableFor({ default: 'A' }, ['fr', 'en'], 'fr')).toEqual({
      default: 'A',
      fr: 'A',
      en: 'A',
    });
    expect(translatableFor({ fr: 'Bonjour', en: 'Hello' }, ['fr', 'en', 'ar'], 'fr')).toEqual({
      default: 'Bonjour',
      fr: 'Bonjour',
      en: 'Hello',
      ar: 'Bonjour',
    });
    expect(translatableFor(undefined, ['en'], 'en')).toEqual({ default: '', en: '' });
  });

  it('names the unanswered field rather than seeding a neutral value for it', () => {
    const { money, ...rest } = COMPLETE_ANSWERS;
    expect(() =>
      buildStoreConfig({ ...rest, money: { ...money, currencyCode: undefined } }),
    ).toThrow(/money\.currencyCode was never answered/);
    expect(() => buildStoreConfig({ ...rest, money, domains: {} })).toThrow(
      /domains\.storefront was never answered/,
    );
  });

  it('surfaces a schema refusal with its path', () => {
    expect(() =>
      buildStoreConfig({
        ...COMPLETE_ANSWERS,
        localization: { ...COMPLETE_ANSWERS.localization, defaultLocale: 'ar' },
      }),
    ).toThrow(ClientConfigError);
    expect(() =>
      buildStoreConfig({
        ...COMPLETE_ANSWERS,
        identity: { ...COMPLETE_ANSWERS.identity, country: 'France' },
      }),
    ).toThrow(/identity\.address\.country/);
  });
});
