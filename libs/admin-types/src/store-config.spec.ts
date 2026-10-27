import {
  STORE_CONFIG_FIXTURE_IDS,
  loadStoreConfigFixture,
  runtimeConfigOfFixture,
} from '@common/store-config-fixtures';
import { isRtlLocale, parseStoreConfig, storeConfigResponseSchema } from './store-config';

describe('storeConfigSchema (wire contract of GET /v1/store/config)', () => {
  it.each(STORE_CONFIG_FIXTURE_IDS)('parses the %s fixture without its fixture block', (id) => {
    const runtime = runtimeConfigOfFixture(loadStoreConfigFixture(id));
    expect(parseStoreConfig(runtime)).toEqual(runtime);
    expect(storeConfigResponseSchema.parse({ data: runtime }).data).toEqual(runtime);
  });

  it('accepts the empty strings a fresh install carries', () => {
    const runtime = runtimeConfigOfFixture(loadStoreConfigFixture('demo'));
    const fresh = {
      ...runtime,
      identity: {
        ...runtime.identity,
        contact: { email: '', phone: '' },
        address: { ...runtime.identity.address, locality: '', region: '', country: '' },
        areaServed: [],
      },
      domains: { storefront: '', admin: 'http://localhost:53200', api: '' },
    };
    expect(parseStoreConfig(fresh)).toEqual(fresh);
  });

  it('rejects a key the contract does not declare', () => {
    const runtime = runtimeConfigOfFixture(loadStoreConfigFixture('demo'));
    expect(() => parseStoreConfig({ ...runtime, unknownGroup: { status: 'valid' } })).toThrow();
  });

  it('rejects an RTL locale outside the supported set', () => {
    const runtime = runtimeConfigOfFixture(loadStoreConfigFixture('maghreb-ltr'));
    expect(() =>
      parseStoreConfig({
        ...runtime,
        localization: { ...runtime.localization, rtlLocales: ['ar'] },
      }),
    ).toThrow(/rtl locale ar/);
  });

  it('reports direction from the config, not from the locale name', () => {
    expect(isRtlLocale(loadStoreConfigFixture('gulf-rtl'), 'ar')).toBe(true);
    expect(isRtlLocale(loadStoreConfigFixture('gulf-rtl'), 'en')).toBe(false);
    expect(isRtlLocale(loadStoreConfigFixture('maghreb-ltr'), 'fr')).toBe(false);
  });
});
