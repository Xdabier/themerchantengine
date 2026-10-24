import {
  LOCALE_CATALOGUE,
  NEUTRAL_LOCALE_SET,
  StoreLocales,
  normalise,
  staticLocaleSource,
} from './store-locales';

describe('StoreLocales', () => {
  it('boots on the neutral set', () => {
    const locales = new StoreLocales();
    expect(locales.current()).toEqual(NEUTRAL_LOCALE_SET);
    expect(locales.direction('fr')).toBe('ltr');
  });

  it('replaces the snapshot and reports RTL from the set, not the locale name', () => {
    const locales = new StoreLocales();
    locales.set({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'ar',
      rtlLocales: ['ar'],
      timezone: 'Asia/Dubai',
    });
    expect(locales.current().timezone).toBe('Asia/Dubai');
    expect(locales.current().defaultLocale).toBe('ar');
    expect(locales.isRtl('ar')).toBe(true);
    expect(locales.direction('en')).toBe('ltr');
    expect(locales.isSupported('fr')).toBe(false);

    locales.set({
      supportedLocales: ['ar', 'en'],
      defaultLocale: 'en',
      rtlLocales: [],
      timezone: 'UTC',
    });
    expect(locales.isRtl('ar')).toBe(false);
  });

  it('drops locales outside the catalogue and keeps the set consistent', () => {
    const set = normalise({
      supportedLocales: ['de', 'fr', 'ar'],
      defaultLocale: 'de',
      rtlLocales: ['ar', 'he'],
      timezone: 'Mars/Olympus',
    });
    expect(set).toEqual({
      supportedLocales: ['fr', 'ar'],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
    for (const locale of set.supportedLocales) expect(LOCALE_CATALOGUE).toContain(locale);
  });

  it('falls back to the neutral set when nothing supported survives', () => {
    expect(
      normalise({ supportedLocales: ['xx'], defaultLocale: 'xx', rtlLocales: [], timezone: 'UTC' }),
    ).toEqual(NEUTRAL_LOCALE_SET);
  });

  it('freezes the snapshot so a consumer cannot mutate the shared set', () => {
    const source = staticLocaleSource(['fr', 'en'], 'en');
    expect(Object.isFrozen(source.current())).toBe(true);
    expect(Object.isFrozen(source.current().supportedLocales)).toBe(true);
  });
});
