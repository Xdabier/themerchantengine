import { describe, expect, it, vi } from 'vitest';

import { NEUTRAL_STOREFRONT_RUNTIME_CONFIG } from '@storefront-types';

import { proxyTextSurface } from '../proxy-seo';

// The default locale is the store's, read through the cached config. Stubbed
// to ar so a hardcoded fr upstream header fails here.
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

function makeEvent(reqHeaders: Record<string, string> = {}) {
  const recordedHeaders: Record<string, string> = {};
  let statusCode = 0;
  const event = {
    node: {
      req: {
        headers: reqHeaders,
      },
      res: {
        get statusCode() {
          return statusCode;
        },
        set statusCode(v: number) {
          statusCode = v;
        },
        setHeader(name: string, value: string) {
          recordedHeaders[name.toLowerCase()] = value;
        },
        getHeader(name: string) {
          return recordedHeaders[name.toLowerCase()];
        },
      },
    },
  } as unknown as Parameters<typeof proxyTextSurface>[0];
  return { event, recordedHeaders, getStatus: () => statusCode };
}

function fakeOk(body: string): typeof fetch {
  return vi.fn(
    async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } }),
  ) as unknown as typeof fetch;
}

describe('proxyTextSurface — forwardAcceptLanguage', () => {
  it('forwards inbound Accept-Language to upstream when flag is set', async () => {
    const fetchImpl = fakeOk('# en content');
    const { event } = makeEvent({ 'accept-language': 'en-US,en;q=0.9' });

    await proxyTextSurface(event, {
      upstreamPath: '/v1/llms.txt',
      contentType: 'text/plain; charset=utf-8',
      cacheControl: 'public, max-age=600',
      forwardAcceptLanguage: true,
      fetchImpl,
    });

    const callArgs = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('en-US,en;q=0.9');
  });

  it('forces the store default locale upstream when flag is unset (sitemap, robots.txt)', async () => {
    const fetchImpl = fakeOk('<urlset/>');
    const { event } = makeEvent({ 'accept-language': 'en-US' });

    await proxyTextSurface(event, {
      upstreamPath: '/v1/sitemap_index.xml',
      contentType: 'application/xml; charset=utf-8',
      cacheControl: 'public, max-age=300',
      fetchImpl,
    });

    const callArgs = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('ar');
  });

  it('emits Vary: Accept-Language on responses to locale-aware surfaces', async () => {
    const fetchImpl = fakeOk('# content');
    const { event, recordedHeaders } = makeEvent({ 'accept-language': 'fr' });

    await proxyTextSurface(event, {
      upstreamPath: '/v1/llms.txt',
      contentType: 'text/plain; charset=utf-8',
      cacheControl: 'public, max-age=600',
      forwardAcceptLanguage: true,
      fetchImpl,
    });

    expect(recordedHeaders['vary']).toBe('Accept-Language');
  });

  it('omits Vary on locale-agnostic surfaces (CDNs cache one copy for everyone)', async () => {
    const fetchImpl = fakeOk('<urlset/>');
    const { event, recordedHeaders } = makeEvent();

    await proxyTextSurface(event, {
      upstreamPath: '/v1/sitemap_index.xml',
      contentType: 'application/xml; charset=utf-8',
      cacheControl: 'public, max-age=300',
      fetchImpl,
    });

    expect(recordedHeaders['vary']).toBeUndefined();
  });
});
