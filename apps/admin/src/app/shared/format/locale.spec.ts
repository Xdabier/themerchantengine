import { LOCALE_REGISTRY, registryLocaleCodes } from '@common/locale';
import { localeLabel } from './locale';

describe('localeLabel', () => {
  it('names every registry locale by its own name', () => {
    for (const code of registryLocaleCodes()) {
      expect(localeLabel(code)).toBe(LOCALE_REGISTRY[code].nativeName);
    }
  });

  it('names the shipped locales', () => {
    expect(localeLabel('fr')).toBe('Français');
    expect(localeLabel('en')).toBe('English');
    expect(localeLabel('ar')).toBe('العربية');
  });

  it('upper-cases a code the registry does not know rather than rendering blank', () => {
    expect(localeLabel('zz')).toBe('ZZ');
    expect(localeLabel('es')).toBe('ES');
  });
});
