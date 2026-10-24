import {
  STORE_CONFIG_FIXTURE_IDS,
  activeStoreConfigFixture,
  activeStoreConfigFixtureId,
  describeHarnessStoreConfig,
  harnessStoreConfigFixture,
  harnessStoreConfigFixtureId,
  loadStoreConfigFixture,
  storeConfigFixtureSchema,
} from './index';

describe('store config fixtures', () => {
  it.each(STORE_CONFIG_FIXTURE_IDS)('%s parses and carries its own id', (id) => {
    const fixture = loadStoreConfigFixture(id);
    expect(fixture.fixture.id).toBe(id);
  });

  it('gulf-rtl is Arabic-first, RTL, two decimals, symbol before, no tax mention', () => {
    const gulf = loadStoreConfigFixture('gulf-rtl');
    expect(gulf.localization.supportedLocales).toEqual(['ar', 'en']);
    expect(gulf.localization.defaultLocale).toBe('ar');
    expect(gulf.localization.rtlLocales).toEqual(['ar']);
    expect(gulf.brand.fontKit).toBe('arabic-latin');
    expect(gulf.money.displayPrecision).toBe(2);
    expect(gulf.money.symbolPosition).toBe('before');
    expect(gulf.money.taxDisplay).toBe('none');
    expect(gulf.money.vatRate).toBe(0.05);
    expect(gulf.identity.address.postalCode).toBeNull();
  });

  it('maghreb-ltr is French-first, LTR, three decimals, symbol after, HT with 19 percent VAT', () => {
    const maghreb = loadStoreConfigFixture('maghreb-ltr');
    expect(maghreb.localization.supportedLocales).toEqual(['fr', 'en']);
    expect(maghreb.localization.defaultLocale).toBe('fr');
    expect(maghreb.localization.rtlLocales).toEqual([]);
    expect(maghreb.brand.fontKit).toBe('latin-rounded');
    expect(maghreb.money.displayPrecision).toBe(3);
    expect(maghreb.money.symbolPosition).toBe('after');
    expect(maghreb.money.thousandsSeparator).toBe(' ');
    expect(maghreb.money.taxDisplay).toBe('HT');
    expect(maghreb.money.vatRate).toBe(0.19);
  });

  it('trilingual enables ar, fr and en with ar default and RTL', () => {
    const tri = loadStoreConfigFixture('trilingual');
    expect(tri.localization.supportedLocales).toEqual(['ar', 'fr', 'en']);
    expect(tri.localization.defaultLocale).toBe('ar');
    expect(tri.localization.rtlLocales).toEqual(['ar']);
    expect(tri.brand.fontKit).toBe('arabic-latin');
  });

  it('demo is English-first with fr, LTR, EUR, TTC', () => {
    const demo = loadStoreConfigFixture('demo');
    expect(demo.localization.defaultLocale).toBe('en');
    expect(demo.localization.rtlLocales).toEqual([]);
    expect(demo.money.currencyCode).toBe('EUR');
    expect(demo.money.taxDisplay).toBe('TTC');
  });

  it('every Translatable carries every supported locale', () => {
    for (const id of STORE_CONFIG_FIXTURE_IDS) {
      const fixture = loadStoreConfigFixture(id);
      for (const locale of fixture.localization.supportedLocales) {
        expect(fixture.identity.storeName).toHaveProperty(locale);
        expect(fixture.identity.description).toHaveProperty(locale);
        expect(fixture.identity.legalName).toHaveProperty(locale);
        expect(fixture.identity.address.street).toHaveProperty(locale);
      }
    }
  });

  it('resolves the active fixture from STORE_CONFIG_FIXTURE and defaults to demo', () => {
    expect(activeStoreConfigFixtureId({})).toBe('demo');
    expect(activeStoreConfigFixtureId({ STORE_CONFIG_FIXTURE: '' })).toBe('demo');
    expect(activeStoreConfigFixtureId({ STORE_CONFIG_FIXTURE: 'gulf-rtl' })).toBe('gulf-rtl');
    expect(activeStoreConfigFixture({ STORE_CONFIG_FIXTURE: 'maghreb-ltr' }).fixture.id).toBe(
      'maghreb-ltr',
    );
    expect(() => activeStoreConfigFixtureId({ STORE_CONFIG_FIXTURE: 'nope' })).toThrow(
      /not a fixture id/,
    );
  });

  it('harness helpers report null when the variable is unset and the fixture when set', () => {
    expect(harnessStoreConfigFixtureId({})).toBeNull();
    expect(harnessStoreConfigFixture({ STORE_CONFIG_FIXTURE: '' })).toBeNull();
    expect(describeHarnessStoreConfig({})).toContain('STORE_CONFIG_FIXTURE unset');
    expect(harnessStoreConfigFixtureId({ STORE_CONFIG_FIXTURE: 'gulf-rtl' })).toBe('gulf-rtl');
    expect(harnessStoreConfigFixture({ STORE_CONFIG_FIXTURE: 'gulf-rtl' })?.fixture.id).toBe(
      'gulf-rtl',
    );
    expect(describeHarnessStoreConfig({ STORE_CONFIG_FIXTURE: 'demo' })).toBe(
      'store config fixture demo',
    );
    expect(() => harnessStoreConfigFixtureId({ STORE_CONFIG_FIXTURE: 'nope' })).toThrow(
      /not a fixture id/,
    );
  });

  describe('schema guards', () => {
    const base = loadStoreConfigFixture('demo');

    it('rejects an unknown key in any group', () => {
      const withTypo = { ...base, money: { ...base.money, displayPrecison: 2 } };
      expect(storeConfigFixtureSchema.safeParse(withTypo).success).toBe(false);
      expect(storeConfigFixtureSchema.safeParse({ ...base, extra: true }).success).toBe(false);
    });

    it('rejects a default locale outside the supported set', () => {
      const result = storeConfigFixtureSchema.safeParse({
        ...base,
        localization: { ...base.localization, defaultLocale: 'ar' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects ar without an Arabic-capable font kit', () => {
      const result = storeConfigFixtureSchema.safeParse({
        ...base,
        localization: { ...base.localization, supportedLocales: ['en', 'ar'], rtlLocales: ['ar'] },
        identity: {
          ...base.identity,
          storeName: { ...base.identity.storeName, ar: 'x' },
          description: { ...base.identity.description, ar: 'x' },
          legalName: { ...base.identity.legalName, ar: 'x' },
          address: {
            ...base.identity.address,
            street: { ...base.identity.address.street, ar: 'x' },
          },
        },
      });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.success ? [] : result.error.issues)).toContain(
        'font kit that covers its script',
      );
    });

    it('rejects a Translatable missing a supported locale', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the rest pattern omits the key
      const { fr: _fr, ...withoutFr } = base.identity.storeName;
      const result = storeConfigFixtureSchema.safeParse({
        ...base,
        identity: { ...base.identity, storeName: withoutFr },
      });
      expect(result.success).toBe(false);
    });

    it('rejects identical decimal and thousands separators', () => {
      const result = storeConfigFixtureSchema.safeParse({
        ...base,
        money: { ...base.money, thousandsSeparator: ',' },
      });
      expect(result.success).toBe(false);
    });
  });
});
