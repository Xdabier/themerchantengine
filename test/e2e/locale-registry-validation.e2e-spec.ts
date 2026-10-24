/**
 * The locale settings endpoints validate against the language registry, and
 * `rtlLocales` is persisted with the set (plan LG2.4, LG2.5).
 *
 * Real dockerized DB per constitution §3.8. Every value the spec writes is
 * restored in teardown through the same endpoints.
 */
import { ADMIN, api, flushRedisKeys, loginAs } from './helpers';

const CACHE_PATTERN = 'store*:config';

interface LocaleSet {
  supportedLocales: string[];
  defaultLocale: string;
  rtlLocales: string[];
}

describe('Locale settings validate against the language registry', () => {
  let adminCookie: string;
  let saved: LocaleSet;

  async function readLocales(): Promise<LocaleSet> {
    await flushRedisKeys(CACHE_PATTERN);
    const res = await api().get('/v1/store/config').set('X-Resolve-Locale', 'false').expect(200);
    return res.body.data.localization as LocaleSet;
  }

  async function writeLocales(set: LocaleSet): Promise<void> {
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
      .send({ rtlLocales: set.rtlLocales })
      .expect(200);
    await flushRedisKeys(CACHE_PATTERN);
  }

  beforeAll(async () => {
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    saved = await readLocales();
  });

  afterAll(async () => {
    await writeLocales(saved);
  });

  it('refuses a locale the registry does not hold, with a stable error body', async () => {
    const res = await api()
      .patch('/v1/admin/settings/locales')
      .set('Cookie', adminCookie)
      .send({ supportedLocales: [saved.defaultLocale, 'xx'], defaultLocale: saved.defaultLocale })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await readLocales()).toEqual(saved);
  });

  it('refuses an unknown default locale', async () => {
    const res = await api()
      .patch('/v1/admin/settings/locales')
      .set('Cookie', adminCookie)
      .send({ supportedLocales: saved.supportedLocales, defaultLocale: 'xx' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses an unknown right-to-left locale', async () => {
    const res = await api()
      .patch('/v1/admin/settings/locales')
      .set('Cookie', adminCookie)
      .send({
        supportedLocales: saved.supportedLocales,
        defaultLocale: saved.defaultLocale,
        rtlLocales: ['xx'],
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a registry locale the store has not enabled on a Translatable write', async () => {
    await writeLocales({ supportedLocales: ['fr', 'en'], defaultLocale: 'fr', rtlLocales: [] });
    const res = await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ description: { default: 'Store', ar: 'متجر' } })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('persists rtlLocales written with the set', async () => {
    await api()
      .patch('/v1/admin/settings/locales')
      .set('Cookie', adminCookie)
      .send({
        supportedLocales: ['fr', 'en', 'ar'],
        defaultLocale: 'fr',
        rtlLocales: ['ar'],
      })
      .expect(200);
    const locales = await readLocales();
    expect(locales.supportedLocales).toEqual(['fr', 'en', 'ar']);
    expect(locales.rtlLocales).toEqual(['ar']);
  });
});
