import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { H3Event } from 'h3';

import { NEUTRAL_STOREFRONT_RUNTIME_CONFIG } from '@storefront-types';

import { proxyTextSurface } from './proxy-seo';

// The default locale is the store's, read through the cached config. Stubbed
// to ar so a hardcoded fr upstream header fails here.
vi.mock('./store-config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./store-config')>();
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

interface FakeEvent {
  status: number;
  headers: Record<string, string>;
}

function createFakeEvent(): { event: H3Event; recorded: FakeEvent } {
  const recorded: FakeEvent = { status: 0, headers: {} };
  const event = {
    node: {
      res: {
        statusCode: 0,
        setHeader(name: string, value: string) {
          recorded.headers[name.toLowerCase()] = value;
        },
        getHeader(name: string) {
          return recorded.headers[name.toLowerCase()];
        },
      },
    },
  } as unknown as H3Event;
  // h3's setResponseStatus writes to event.node.res.statusCode and
  // setResponseHeader writes via res.setHeader, so the fake above is
  // sufficient. We mirror statusCode after the fact.
  Object.defineProperty(recorded, 'status', {
    get() {
      return (event as unknown as { node: { res: { statusCode: number } } }).node.res.statusCode;
    },
  });
  return { event, recorded };
}

describe('proxyTextSurface', () => {
  const ORIGINAL_ENV = process.env['STOREFRONT_API_URL'];

  beforeEach(() => {
    process.env['STOREFRONT_API_URL'] = 'http://api.test/api';
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env['STOREFRONT_API_URL'];
    else process.env['STOREFRONT_API_URL'] = ORIGINAL_ENV;
  });

  it('forwards GET to the configured upstream with the store default Accept-Language and an X-Request-Id', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('<xml/>', { status: 200 }));
    const { event } = createFakeEvent();
    await proxyTextSurface(event, {
      upstreamPath: '/v1/sitemap_index.xml',
      contentType: 'application/xml; charset=utf-8',
      cacheControl: 'public, max-age=300, s-maxage=3600',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe('http://api.test/api/v1/sitemap_index.xml');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Accept-Language']).toBe('ar');
    expect(headers['X-Request-Id']).toMatch(/[0-9a-z-]+/i);
  });

  it('sets storefront content-type + cache-control + X-Request-Id on success', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('<urlset><url><loc>https://x</loc></url></urlset>', { status: 200 }),
    );
    const { event, recorded } = createFakeEvent();
    const body = await proxyTextSurface(event, {
      upstreamPath: '/v1/sitemap-products.xml',
      contentType: 'application/xml; charset=utf-8',
      cacheControl: 'public, max-age=300, s-maxage=3600',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(body).toContain('<urlset>');
    expect(recorded.status).toBe(200);
    expect(recorded.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(recorded.headers['cache-control']).toBe('public, max-age=300, s-maxage=3600');
    expect(recorded.headers['x-request-id']).toMatch(/[0-9a-z-]+/i);
  });

  it('returns 502 with a text body when the upstream throws', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('econn');
    });
    const { event, recorded } = createFakeEvent();
    const body = await proxyTextSurface(event, {
      upstreamPath: '/v1/sitemap_index.xml',
      contentType: 'application/xml; charset=utf-8',
      cacheControl: 'public, max-age=60',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(recorded.status).toBe(502);
    expect(recorded.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(body).toBe('Upstream unreachable');
  });

  it('returns 502 when the upstream responds with a non-2xx status', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('boom', { status: 503 }));
    const { event, recorded } = createFakeEvent();
    const body = await proxyTextSurface(event, {
      upstreamPath: '/v1/llms.txt',
      contentType: 'text/plain; charset=utf-8',
      cacheControl: 'public, max-age=60',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(recorded.status).toBe(502);
    expect(body).toBe('Upstream responded 503');
  });

  it('falls back to the localhost API base when STOREFRONT_API_URL is unset', async () => {
    delete process.env['STOREFRONT_API_URL'];
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('ok', { status: 200 }));
    const { event } = createFakeEvent();
    await proxyTextSurface(event, {
      upstreamPath: '/v1/robots.txt',
      contentType: 'text/plain; charset=utf-8',
      cacheControl: 'public, max-age=60',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe('http://localhost:53000/api/v1/robots.txt');
  });

  it('strips a trailing slash on STOREFRONT_API_URL before joining', async () => {
    process.env['STOREFRONT_API_URL'] = 'http://api.test/api/';
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('ok', { status: 200 }));
    const { event } = createFakeEvent();
    await proxyTextSurface(event, {
      upstreamPath: '/v1/robots.txt',
      contentType: 'text/plain; charset=utf-8',
      cacheControl: 'public, max-age=60',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe('http://api.test/api/v1/robots.txt');
  });
});
