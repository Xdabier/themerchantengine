/**
 * The Translatable fallback chain follows the runtime locale config
 * (plan E1.3.3, DR-31): requested locale, then the store default locale,
 * then `default`. This is the assertion E0.4.4 left for E1.3 while the
 * interceptor still hardcoded a locale pair.
 *
 * The locale set is written through the admin settings endpoints rather than
 * straight into the database, because that is the path that emits
 * `store-config.updated`, and the running API refreshes its in-memory locale
 * snapshot from that event. A row written by Prisma alone would change what
 * the endpoint reports without changing what the interceptor resolves, which
 * is exactly the seam this spec exists to cover.
 *
 * Real dockerized DB per constitution §3.8. Every value it writes is restored
 * in teardown through the same endpoints.
 */
import { LOCALE_REGISTRY, registryLocaleCodes, type RegistryLocale } from '@common/locale';
import { loadStoreConfigFixture } from '@common/store-config-fixtures';
import { ADMIN, UNKNOWN_LOCALE, api, flushRedisKeys, loginAs } from './helpers';

const CACHE_PATTERN = 'store*:config';

interface LocaleSet {
  supportedLocales: string[];
  defaultLocale: string;
  rtlLocales: string[];
}

interface Identity {
  storeName: unknown;
}

describe('Translatable fallback chain follows the runtime locale config', () => {
  let adminCookie: string;
  let savedLocales: LocaleSet;
  let savedStoreName: unknown;

  const gulf = loadStoreConfigFixture('gulf-rtl');
  const maghreb = loadStoreConfigFixture('maghreb-ltr');

  async function readLocales(): Promise<LocaleSet> {
    const res = await api().get('/v1/store/config').set('X-Resolve-Locale', 'false').expect(200);
    await flushRedisKeys(CACHE_PATTERN);
    return res.body.data.localization as LocaleSet;
  }

  async function applyLocales(set: LocaleSet, storeName: unknown): Promise<void> {
    await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ rtlLocales: [] })
      .expect(200);
    await api()
      .patch('/v1/admin/settings/locales')
      .set('Cookie', adminCookie)
      .send({ supportedLocales: set.supportedLocales, defaultLocale: set.defaultLocale })
      .expect(200);
    await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ rtlLocales: set.rtlLocales, storeName })
      .expect(200);
    await flushRedisKeys(CACHE_PATTERN);
  }

  /** The registry refreshes on an async event; give it a moment before asserting. */
  async function storeNameUnder(acceptLanguage: string | null): Promise<string> {
    let last = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      await flushRedisKeys(CACHE_PATTERN);
      const req = api().get('/v1/store/config');
      if (acceptLanguage !== null) req.set('Accept-Language', acceptLanguage);
      const res = await req.expect(200);
      last = (res.body.data.identity as Identity).storeName as string;
      if (attempt > 0 && last === (await expectedFor(acceptLanguage))) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    return last;
  }

  let expectedFor: (acceptLanguage: string | null) => Promise<string>;

  beforeAll(async () => {
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    savedLocales = await readLocales();
    const res = await api().get('/v1/store/config').set('X-Resolve-Locale', 'false').expect(200);
    savedStoreName = (res.body.data.identity as Identity).storeName;
  });

  afterAll(async () => {
    await applyLocales(savedLocales, savedStoreName);
  });

  it('gulf-rtl: Arabic default, so an Arabic request and a request with no header both read Arabic', async () => {
    await applyLocales(gulf.localization, gulf.identity.storeName);
    const name = gulf.identity.storeName as Record<string, string>;
    expectedFor = async (lang) =>
      lang === 'en' ? name['en'] : lang === 'ar' ? name['ar'] : name['default'];

    expect(await storeNameUnder('ar')).toBe(name['ar']);
    expect(await storeNameUnder('en')).toBe(name['en']);
    // No preference stated: the `default` key, which the fixture writes in Arabic.
    expect(await storeNameUnder(null)).toBe(name['default']);
    // French is outside the gulf set, so the store default (Arabic) answers.
    expectedFor = async () => name['ar'];
    expect(await storeNameUnder('fr')).toBe(name['ar']);

    const locales = await readLocales();
    expect(locales.rtlLocales).toEqual(['ar']);
  });

  it('maghreb-ltr: French default, so an Arabic request reads French', async () => {
    await applyLocales(maghreb.localization, maghreb.identity.storeName);
    const name = maghreb.identity.storeName as Record<string, string>;
    expectedFor = async (lang) => (lang === 'en' ? name['en'] : name['fr']);

    expect(await storeNameUnder('fr')).toBe(name['fr']);
    expect(await storeNameUnder('en')).toBe(name['en']);
    // Arabic is outside the maghreb set: store default (French), never English.
    expect(await storeNameUnder('ar')).toBe(name['fr']);
  });

  it('every registry locale enabled: each reads its own name, an unknown code reads the default', async () => {
    const codes = registryLocaleCodes();
    const name: Record<string, string> = Object.fromEntries(
      codes.map((code) => [code, `Spine ${code}`]),
    );
    const defaultLocale = codes[0];
    name['default'] = name[defaultLocale];
    await applyLocales(
      {
        supportedLocales: codes,
        defaultLocale,
        rtlLocales: codes.filter((code) => LOCALE_REGISTRY[code].direction === 'rtl'),
      },
      name,
    );
    expectedFor = async (lang) =>
      lang !== null && codes.includes(lang as RegistryLocale) ? name[lang] : name[defaultLocale];

    for (const code of codes) {
      expect(await storeNameUnder(code)).toBe(name[code]);
    }
    expect(await storeNameUnder(UNKNOWN_LOCALE)).toBe(name[defaultLocale]);
  });
});
