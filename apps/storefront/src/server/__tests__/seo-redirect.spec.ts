import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { NEUTRAL_STOREFRONT_RUNTIME_CONFIG } from '@storefront-types';

import seoRedirectHandler, { __resetSeoRedirectCaches } from '../middleware/seo-redirect';

// The existence check falls back to the store's default locale, read through
// the cached config. Stubbed to ar so a hardcoded fr fails here.
vi.mock('../store-config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../store-config')>();
  return {
    ...mod,
    readStoreConfig: async () => ({
      ...NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
      localization: {
        ...NEUTRAL_STOREFRONT_RUNTIME_CONFIG.localization,
        supportedLocales: ['ar', 'fr'],
        defaultLocale: 'ar',
        rtlLocales: ['ar'],
      },
    }),
  };
});

function createFakeEvent(path: string): { event: H3Event; status: () => number } {
  const res = { statusCode: 200, setHeader: vi.fn(), getHeader: vi.fn() };
  const event = {
    path,
    node: { req: { url: path, headers: {} }, res },
  } as unknown as H3Event;
  return { event, status: () => res.statusCode };
}

describe('seo-redirect middleware, existence check locale', () => {
  const fetchSpy = vi.fn<typeof fetch>();

  beforeEach(() => {
    __resetSeoRedirectCaches();
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/seo/redirects')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/v1/sitemap-')) return new Response('', { status: 404 });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function existenceHeaders(): Record<string, string> {
    const call = fetchSpy.mock.calls.find(([input]) => String(input).includes('/v1/products/'));
    return (call?.[1] as RequestInit).headers as Record<string, string>;
  }

  it('checks a path with an unsupported locale prefix in the store default locale', async () => {
    const { event, status } = createFakeEvent('/de/catalog/product/ghost');
    await seoRedirectHandler(event);
    expect(existenceHeaders()['accept-language']).toBe('ar');
    expect(status()).toBe(404);
  });

  it('keeps the locale of the path when the store serves it', async () => {
    const { event } = createFakeEvent('/fr/catalog/product/ghost');
    await seoRedirectHandler(event);
    expect(existenceHeaders()['accept-language']).toBe('fr');
  });
});
