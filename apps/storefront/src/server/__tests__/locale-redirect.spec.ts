import { describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { NEUTRAL_STOREFRONT_RUNTIME_CONFIG } from '@storefront-types';

import localeRedirectHandler from '../middleware/locale-redirect';

// The middleware reads the store's locale set through the cached config
// read, which reaches whatever API answers on 53000. Stubbed to a fixed pair
// with fr as the default: an installed store with another default locale on
// the developer's machine turned this suite red, and a unit spec must not
// depend on what happens to be listening.
vi.mock('../store-config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../store-config')>();
  return {
    ...mod,
    readStoreConfig: async () => ({
      ...NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
      localization: {
        ...NEUTRAL_STOREFRONT_RUNTIME_CONFIG.localization,
        supportedLocales: ['fr', 'en'],
        defaultLocale: 'fr',
        rtlLocales: [],
      },
    }),
  };
});

interface FakeOpts {
  path?: string;
  /**
   * Override `req.originalUrl` to test the Vite-dev SPA-fallback path,
   * where `event.path` reads `/some-spa-route` but the real browser-issued
   * path was `/`. The middleware prefers `originalUrl` so the redirect
   * still fires under the dev pipeline.
   */
  originalUrl?: string;
  acceptLanguage?: string;
  cookie?: string;
}

interface FakeRecording {
  status?: number;
  location?: string;
  headers: Record<string, string>;
}

function createFakeEvent(opts: FakeOpts = {}): { event: H3Event; recorded: FakeRecording } {
  const recorded: FakeRecording = { headers: {} };
  const reqHeaders: Record<string, string> = {};
  if (opts.acceptLanguage !== undefined) reqHeaders['accept-language'] = opts.acceptLanguage;
  if (opts.cookie !== undefined) reqHeaders['cookie'] = opts.cookie;

  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      const lower = name.toLowerCase();
      recorded.headers[lower] = value;
      if (lower === 'location') recorded.location = value;
    },
    getHeader(name: string) {
      return recorded.headers[name.toLowerCase()];
    },
    end() {
      recorded.status = res.statusCode || undefined;
    },
    writeHead(status: number) {
      res.statusCode = status;
      recorded.status = status;
    },
  };

  const event = {
    path: opts.path ?? '/',
    node: {
      req: {
        url: opts.path ?? '/',
        originalUrl: opts.originalUrl,
        headers: reqHeaders,
      },
      res,
    },
  } as unknown as H3Event;
  return { event, recorded };
}

describe('locale-redirect middleware', () => {
  it('redirects fr-leaning Accept-Language to /fr/', async () => {
    const { event, recorded } = createFakeEvent({
      path: '/',
      acceptLanguage: 'fr-TN,fr;q=0.9,en;q=0.5',
    });
    await localeRedirectHandler(event);
    expect(recorded.location).toBe('/fr/');
    expect(recorded.status).toBe(302);
  });

  it('redirects en-leaning Accept-Language to /en/', async () => {
    const { event, recorded } = createFakeEvent({
      path: '/',
      acceptLanguage: 'en-US,en;q=0.9',
    });
    await localeRedirectHandler(event);
    expect(recorded.location).toBe('/en/');
    expect(recorded.status).toBe(302);
  });

  it('honours the storefront_locale cookie over a conflicting Accept-Language header', async () => {
    const { event, recorded } = createFakeEvent({
      path: '/',
      acceptLanguage: 'en-US,en;q=0.9',
      cookie: 'storefront_locale=fr; another=ignored',
    });
    await localeRedirectHandler(event);
    expect(recorded.location).toBe('/fr/');
  });

  it('ignores a storefront_locale cookie holding an unsupported locale', async () => {
    const { event, recorded } = createFakeEvent({
      path: '/',
      acceptLanguage: 'en-US,en;q=0.9',
      cookie: 'storefront_locale=ar',
    });
    await localeRedirectHandler(event);
    expect(recorded.location).toBe('/en/');
  });

  it('falls back to DEFAULT_LOCALE (fr) when neither header nor cookie resolves', async () => {
    const { event, recorded } = createFakeEvent({ path: '/' });
    await localeRedirectHandler(event);
    expect(recorded.location).toBe('/fr/');
    expect(recorded.status).toBe(302);
  });

  it('treats /index.html the same as /', async () => {
    const { event, recorded } = createFakeEvent({
      path: '/index.html',
      acceptLanguage: 'en;q=1',
    });
    await localeRedirectHandler(event);
    expect(recorded.location).toBe('/en/');
  });

  it('does not redirect requests for non-root paths', async () => {
    const { event, recorded } = createFakeEvent({
      path: '/en/catalog/electronics',
      acceptLanguage: 'fr',
    });
    await localeRedirectHandler(event);
    expect(recorded.location).toBeUndefined();
    expect(recorded.status).toBeUndefined();
  });

  it('honours req.originalUrl over event.path under the Vite-dev SPA fallback', async () => {
    // Vite rewrites `req.url` to the SPA HTML entry for any unmatched
    // route, leaving `req.originalUrl` as the path the browser actually
    // requested. The middleware reads `originalUrl` first so production
    // and Vite-dev share one redirect path.
    const { event, recorded } = createFakeEvent({
      path: '/some-spa-fallback',
      originalUrl: '/',
      acceptLanguage: 'en;q=1',
    });
    await localeRedirectHandler(event);
    expect(recorded.location).toBe('/en/');
    expect(recorded.status).toBe(302);
  });

  it('does not redirect when originalUrl is a non-/ path even if event.path was rewritten to /', async () => {
    const { event, recorded } = createFakeEvent({
      path: '/',
      originalUrl: '/en/catalog/audio',
      acceptLanguage: 'fr',
    });
    await localeRedirectHandler(event);
    expect(recorded.location).toBeUndefined();
    expect(recorded.status).toBeUndefined();
  });

  describe('unsupported locale segments', () => {
    it.each([
      ['/ar/', '/fr/'],
      ['/ar', '/fr/'],
      ['/ar/catalog/electronics', '/fr/catalog/electronics'],
      ['/de/cart', '/fr/cart'],
      ['/pt-BR/catalog/audio', '/fr/catalog/audio'],
      ['/zz', '/fr/'],
    ])('301s %s onto the default locale (%s)', async (from, to) => {
      const { event, recorded } = createFakeEvent({ path: from });
      await localeRedirectHandler(event);
      expect(recorded.location).toBe(to);
      expect(recorded.status).toBe(301);
    });

    it('preserves the query string on the unsupported-locale redirect', async () => {
      const { event, recorded } = createFakeEvent({ path: '/de/search?q=fraise&page=2' });
      await localeRedirectHandler(event);
      expect(recorded.location).toBe('/fr/search?q=fraise&page=2');
      expect(recorded.status).toBe(301);
    });

    it('does not let a cookie or Accept-Language steer the unsupported-locale redirect', async () => {
      const { event, recorded } = createFakeEvent({
        path: '/de/cart',
        acceptLanguage: 'en-US,en;q=0.9',
        cookie: 'storefront_locale=en',
      });
      await localeRedirectHandler(event);
      expect(recorded.location).toBe('/fr/cart');
      expect(recorded.status).toBe(301);
    });

    it.each(['/fr/', '/en/', '/fr', '/en', '/fr/catalog', '/en/cart?ref=home'])(
      'passes the supported locale path %s through untouched',
      async (path) => {
        const { event, recorded } = createFakeEvent({ path });
        await localeRedirectHandler(event);
        expect(recorded.location).toBeUndefined();
        expect(recorded.status).toBeUndefined();
      },
    );

    it.each([
      '/robots.txt',
      '/sitemap.xml',
      '/api/v1/products',
      '/brand/logo.svg',
      '/_analog/pages/fr/index',
      '/assets/main.js',
      '/healthz',
    ])('leaves the non-language-tag path %s untouched', async (path) => {
      // These are what stop the redirect from eating static assets and API
      // routes: none of them is a two-letter first segment.
      const { event, recorded } = createFakeEvent({ path });
      await localeRedirectHandler(event);
      expect(recorded.location).toBeUndefined();
      expect(recorded.status).toBeUndefined();
    });
  });
});
