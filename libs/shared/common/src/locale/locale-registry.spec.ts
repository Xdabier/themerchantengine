import {
  FONT_KIT_SCRIPTS,
  LOCALE_REGISTRY,
  LOCALE_REGISTRY_FIELDS,
  fontKitCoversLocale,
  getLocaleDefinition,
  isRegistryLocale,
  missingRegistryFields,
  registryLocaleCodes,
  type LocaleDefinition,
} from './locale-registry';

describe('locale registry', () => {
  it('ships fr, en and ar', () => {
    expect(registryLocaleCodes()).toEqual(['fr', 'en', 'ar']);
  });

  it('carries every declared field on every locale (parity canary)', () => {
    for (const definition of Object.values(LOCALE_REGISTRY)) {
      expect(missingRegistryFields(definition)).toEqual([]);
    }
  });

  it('canary: a definition missing a field is reported', () => {
    const partial: Partial<LocaleDefinition> = { ...LOCALE_REGISTRY.fr };
    delete partial.nativeName;
    expect(missingRegistryFields(partial)).toEqual(['nativeName']);
    expect(LOCALE_REGISTRY_FIELDS).toContain('nativeName');
  });

  it('canary: an empty string counts as missing', () => {
    expect(missingRegistryFields({ ...LOCALE_REGISTRY.en, intlTag: '' })).toEqual(['intlTag']);
  });

  it('keys every definition by its own code', () => {
    for (const [code, definition] of Object.entries(LOCALE_REGISTRY)) {
      expect(definition.code).toBe(code);
    }
  });

  it('states direction and script per locale', () => {
    expect(getLocaleDefinition('ar')).toMatchObject({ direction: 'rtl', script: 'arabic' });
    expect(getLocaleDefinition('fr')).toMatchObject({ direction: 'ltr', script: 'latin' });
    expect(getLocaleDefinition('en')).toMatchObject({ direction: 'ltr', script: 'latin' });
  });

  it('flags French high punctuation spacing only on fr', () => {
    expect(getLocaleDefinition('fr')?.typography.spaceBeforeHighPunctuation).toBe(true);
    expect(getLocaleDefinition('en')?.typography.spaceBeforeHighPunctuation).toBe(false);
    expect(getLocaleDefinition('ar')?.typography.spaceBeforeHighPunctuation).toBe(false);
  });

  it('recognises registry codes and rejects unknown ones', () => {
    expect(isRegistryLocale('ar')).toBe(true);
    expect(isRegistryLocale('de')).toBe(false);
    expect(isRegistryLocale('toString')).toBe(false);
    expect(getLocaleDefinition('de')).toBeUndefined();
  });

  it('reads font kit coverage from script data', () => {
    expect(FONT_KIT_SCRIPTS['latin-rounded']).toEqual(['latin']);
    expect(fontKitCoversLocale('latin-rounded', 'fr')).toBe(true);
    expect(fontKitCoversLocale('latin-rounded', 'ar')).toBe(false);
    expect(fontKitCoversLocale('arabic-latin', 'ar')).toBe(true);
    expect(fontKitCoversLocale('arabic-latin', 'en')).toBe(true);
  });
});
