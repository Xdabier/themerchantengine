import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { ConfigService } from '@nestjs/config';
import { supportedLocales } from './seo.constants';
import { entityPath, localeProductUrls, resolvePublicBaseUrl } from './site-url';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('resolvePublicBaseUrl', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('reads STOREFRONT_PUBLIC_BASE_URL when set', () => {
    const config = makeConfig({ STOREFRONT_PUBLIC_BASE_URL: 'https://atlas.example' });
    expect(resolvePublicBaseUrl(config)).toBe('https://atlas.example');
  });

  it('falls back to legacy SITE_URL when STOREFRONT_PUBLIC_BASE_URL is unset', () => {
    const config = makeConfig({ SITE_URL: 'https://atlas.example' });
    expect(resolvePublicBaseUrl(config)).toBe('https://atlas.example');
  });

  it('strips a single trailing slash', () => {
    const config = makeConfig({ STOREFRONT_PUBLIC_BASE_URL: 'https://atlas.example/' });
    expect(resolvePublicBaseUrl(config)).toBe('https://atlas.example');
  });

  it('throws in production when both env vars are unset (prevents example.com regression)', () => {
    process.env.NODE_ENV = 'production';
    const config = makeConfig({});
    expect(() => resolvePublicBaseUrl(config)).toThrow(/STOREFRONT_PUBLIC_BASE_URL/);
  });

  it.each([['staging'], ['prod'], [undefined]])(
    'throws under NODE_ENV=%s, because every label outside test and development is production',
    (label) => {
      if (label === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = label;
      const config = makeConfig({});
      expect(() => resolvePublicBaseUrl(config)).toThrow(/STOREFRONT_PUBLIC_BASE_URL/);
    },
  );

  it('returns the dev fallback outside production', () => {
    process.env.NODE_ENV = 'development';
    const config = makeConfig({});
    expect(resolvePublicBaseUrl(config)).toBe('http://localhost:53300');
  });
});

describe('entityPath', () => {
  it('builds the locale-prefixed product path', () => {
    expect(entityPath('product', 'widget', 'en')).toBe('/en/catalog/product/widget');
    expect(entityPath('product', 'widget', 'fr')).toBe('/fr/catalog/product/widget');
  });

  it('builds the locale-prefixed category and page paths', () => {
    expect(entityPath('category', 'shoes', 'en')).toBe('/en/catalog/shoes');
    // Mirrors apps/storefront/src/app/pages/[locale]/pages/[slug].page.ts,
    // the only route that serves a CMS slug generically. Emitting /fr/about
    // here is what made the pages sitemap a list of soft 404s.
    expect(entityPath('page', 'about', 'fr')).toBe('/fr/pages/about');
  });

  it('normalizes the leading slash CMS slugs are stored with', () => {
    expect(entityPath('page', '/faq', 'en')).toBe('/en/pages/faq');
    expect(entityPath('page', '/faq/', 'en')).toBe('/en/pages/faq');
  });
});

/**
 * D8.15 decided the route words stay English: `/fr/catalog/product/<slug>`,
 * never `/fr/catalogue/produit/<slug>`. `entityPath` is the one place that
 * shapes them, and the sitemap, the canonical tag and the IndexNow submit all
 * follow from it, so a French segment introduced here would move every emitted
 * URL at once onto paths the Analog route tree does not serve.
 */
describe('entityPath route words', () => {
  it('keeps the English segments under a French locale', () => {
    expect(entityPath('product', 'fraise-diamantee', 'fr')).toBe(
      '/fr/catalog/product/fraise-diamantee',
    );
    expect(entityPath('category', 'fraises', 'fr')).toBe('/fr/catalog/fraises');
    expect(entityPath('page', 'a-propos', 'fr')).toBe('/fr/pages/a-propos');
  });

  it('emits no French route word for any entity type or locale', () => {
    for (const locale of supportedLocales()) {
      for (const type of ['product', 'category', 'page'] as const) {
        const path = entityPath(type, 'slug', locale);
        expect(path).not.toMatch(/\/catalogue(\/|$)/);
        expect(path).not.toMatch(/\/produits?(\/|$)/);
      }
    }
  });
});

describe('localeProductUrls', () => {
  it('emits one absolute URL per supported locale', () => {
    expect(localeProductUrls('https://atlas.example', 'widget')).toEqual([
      'https://atlas.example/fr/catalog/product/widget',
      'https://atlas.example/en/catalog/product/widget',
    ]);
  });

  it('covers every supported locale, so adding one cannot silently drop a URL', () => {
    // Derived, not frozen: IndexNow advertises all locale variants of a
    // changed product, and a locale missing here never reaches a crawler.
    const urls = localeProductUrls('https://atlas.example', 'widget');
    expect(urls).toHaveLength(supportedLocales().length);
    for (const locale of supportedLocales()) {
      expect(urls).toContain(`https://atlas.example/${locale}/catalog/product/widget`);
    }
  });

  it('strips a trailing slash on the base before composing', () => {
    expect(localeProductUrls('https://atlas.example/', 'widget')).toEqual([
      'https://atlas.example/fr/catalog/product/widget',
      'https://atlas.example/en/catalog/product/widget',
    ]);
  });
});
