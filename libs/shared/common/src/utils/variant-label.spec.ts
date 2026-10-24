import { NEUTRAL_LOCALE_SET, storeLocales } from '../locale/store-locales';
import { buildVariantLabel } from './variant-label';

describe('buildVariantLabel', () => {
  const METAL = { attributeValue: { value: { default: 'Métal', fr: 'Métal', en: 'Metal' } } };
  const LARGE = { attributeValue: { value: { default: 'Grand', fr: 'Grand', en: 'Large' } } };

  it('resolves every Translatable value to the requested locale', () => {
    expect(buildVariantLabel([METAL, LARGE], 'en')).toBe('Metal, Large');
    expect(buildVariantLabel([METAL, LARGE], 'fr')).toBe('Métal, Grand');
  });

  it('falls back to the default rung when no locale is stated', () => {
    expect(buildVariantLabel([METAL, LARGE], 'default')).toBe('Métal, Grand');
  });

  it('falls through to the store default then default for a locale the row does not carry', () => {
    // The middle rung is the store default locale (DR-31); this store's is en.
    storeLocales.set({
      supportedLocales: ['fr', 'en'],
      defaultLocale: 'en',
      rtlLocales: [],
      timezone: 'UTC',
    });
    try {
      const partial = { attributeValue: { value: { default: 'Métal', en: 'Metal' } } };
      expect(buildVariantLabel([partial], 'de')).toBe('Metal');
      expect(buildVariantLabel([{ attributeValue: { value: { default: 'Métal' } } }], 'de')).toBe(
        'Métal',
      );
    } finally {
      storeLocales.set(NEUTRAL_LOCALE_SET);
    }
  });

  it('accepts a plain string value unchanged', () => {
    expect(buildVariantLabel([{ attributeValue: { value: 'XL' } }], 'en')).toBe('XL');
  });

  it('returns null for an empty, missing or unresolvable set', () => {
    expect(buildVariantLabel([], 'en')).toBeNull();
    expect(buildVariantLabel(undefined, 'en')).toBeNull();
    expect(buildVariantLabel(null, 'en')).toBeNull();
    expect(buildVariantLabel([{ attributeValue: { value: null } }], 'en')).toBeNull();
  });

  it('drops the unresolvable members rather than joining an empty string', () => {
    expect(buildVariantLabel([METAL, { attributeValue: { value: null } }], 'en')).toBe('Metal');
  });

  // The regression this helper exists for: a raw join stringifies the object.
  it('never produces "[object Object]"', () => {
    expect(buildVariantLabel([METAL, LARGE], 'en')).not.toContain('[object Object]');
  });
});
