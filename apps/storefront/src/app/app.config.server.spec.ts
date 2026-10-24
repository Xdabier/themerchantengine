import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it } from 'vitest';
import { StorefrontUnauthorizedError } from '@storefront-types';

import { SSR_API_BASE_URL, createServerApiClient } from '../server/server-api-client-factory';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function mockFetch(responder: (url: string, init: RequestInit) => Promise<Response> | Response): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const recordedInit = (init ?? {}) as RequestInit;
    calls.push({ url, init: recordedInit });
    return responder(url, recordedInit);
  };
  return { fetchImpl, calls };
}

interface MockResShape extends Pick<ServerResponse, 'setHeader' | 'getHeader' | 'appendHeader'> {
  readonly headers: Record<string, string | string[]>;
  readonly setCookies: string[];
}

function mockReq(
  overrides: {
    url?: string;
    originalUrl?: string;
    headers?: IncomingHttpHeaders;
  } = {},
): IncomingMessage & { originalUrl: string } {
  const headers: IncomingHttpHeaders = overrides.headers ?? {};
  return {
    url: overrides.url ?? '/fr/',
    originalUrl: overrides.originalUrl ?? overrides.url ?? '/fr/',
    headers,
  } as unknown as IncomingMessage & { originalUrl: string };
}

function mockRes(opts: { withAppendHeader?: boolean } = {}): MockResShape & ServerResponse {
  const headers: Record<string, string | string[]> = {};
  const setCookies: string[] = [];

  const setHeader = (name: string, value: string | number | readonly string[]): ServerResponse => {
    const key = name.toLowerCase();
    if (key === 'set-cookie') {
      const arr = Array.isArray(value) ? Array.from(value) : [String(value)];
      headers[key] = arr;
      setCookies.length = 0;
      setCookies.push(...arr);
    } else {
      headers[key] = String(value);
    }
    return res as unknown as ServerResponse;
  };

  const getHeader = (name: string): string | string[] | undefined => headers[name.toLowerCase()];

  const appendHeader = (name: string, value: string | string[]): ServerResponse => {
    const key = name.toLowerCase();
    if (key === 'set-cookie') {
      const incoming = Array.isArray(value) ? value : [value];
      setCookies.push(...incoming);
      headers[key] = [...setCookies];
    } else {
      const existing = headers[key];
      if (existing === undefined) {
        headers[key] = String(value);
      } else if (Array.isArray(existing)) {
        headers[key] = [...existing, ...(Array.isArray(value) ? value : [String(value)])];
      } else {
        headers[key] = [String(existing), ...(Array.isArray(value) ? value : [String(value)])];
      }
    }
    return res as unknown as ServerResponse;
  };

  const res: MockResShape = {
    headers,
    setCookies,
    setHeader: setHeader as ServerResponse['setHeader'],
    getHeader: getHeader as ServerResponse['getHeader'],
  } as MockResShape;
  if (opts.withAppendHeader !== false) {
    (res as MockResShape & { appendHeader: ServerResponse['appendHeader'] }).appendHeader =
      appendHeader as ServerResponse['appendHeader'];
  }
  return res as unknown as MockResShape & ServerResponse;
}

const okJson = (body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('createServerApiClient', () => {
  it('forwards the inbound cookie header byte-for-byte', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const cookie = 'sessionId=abc123; refreshToken=xyz.789.token; preferred-locale=ar';
    const req = mockReq({
      url: '/fr/catalog',
      headers: { cookie, host: 'store.example' },
    });
    const res = mockRes();

    const client = createServerApiClient(req, res, {
      baseUrl: 'http://localhost:53000',
      fetchImpl,
    });
    await client.get('/v1/products');

    expect(new Headers(calls[0].init.headers).get('Cookie')).toBe(cookie);
  });

  it('derives locale from the URL prefix, not from Accept-Language', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const req = mockReq({
      url: '/en/catalog/product/foo',
      // Accept-Language deliberately disagrees with the URL — URL must win.
      headers: { 'accept-language': 'fr-QA,ar;q=0.9,fr;q=0.5' },
    });
    const client = createServerApiClient(req, mockRes(), {
      baseUrl: '',
      fetchImpl,
    });
    await client.get('/v1/products/foo');

    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe('en');
  });

  it('falls back to the default locale (ar) when the URL has no locale prefix', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const req = mockReq({ url: '/healthz' });
    const client = createServerApiClient(req, mockRes(), { baseUrl: '', fetchImpl });
    await client.get('/v1/health');

    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe('fr');
  });

  it('propagates X-Request-Id from the inbound header', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const req = mockReq({
      url: '/fr/',
      headers: { 'x-request-id': 'edge-trace-9f1c' },
    });
    const client = createServerApiClient(req, mockRes(), { baseUrl: '', fetchImpl });
    await client.get('/v1/categories');

    expect(new Headers(calls[0].init.headers).get('X-Request-Id')).toBe('edge-trace-9f1c');
  });

  it('defaults X-Request-Id when the inbound header is absent', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const req = mockReq({ url: '/fr/' });
    const client = createServerApiClient(req, mockRes(), { baseUrl: '', fetchImpl });
    await client.get('/v1/categories');

    const value = new Headers(calls[0].init.headers).get('X-Request-Id');
    expect(value).toBeTruthy();
    // crypto.randomUUID() shape — 8-4-4-4-12 hex.
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('pipes Set-Cookie response headers back through res.appendHeader', async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: [
            ['content-type', 'application/json'],
            [
              'set-cookie',
              '__Host-refreshToken=v2-rotated; Path=/; HttpOnly; Secure; SameSite=Strict',
            ],
            ['set-cookie', '__Secure-sessionId=sess-v2; Path=/; HttpOnly; Secure; SameSite=Lax'],
          ],
        }),
    );
    const res = mockRes();
    const client = createServerApiClient(mockReq({ url: '/fr/' }), res, {
      baseUrl: '',
      fetchImpl,
    });
    await client.get('/v1/me');

    expect(res.setCookies).toEqual([
      '__Host-refreshToken=v2-rotated; Path=/; HttpOnly; Secure; SameSite=Strict',
      '__Secure-sessionId=sess-v2; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  it('round-trips __Host- and __Secure- cookie prefixes verbatim', async () => {
    const { fetchImpl } = mockFetch(() => {
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.append('set-cookie', '__Host-csrf=abc; Path=/; Secure; SameSite=Strict; HttpOnly');
      headers.append('set-cookie', '__Secure-cart=42; Path=/; Secure; SameSite=Lax');
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers });
    });
    const res = mockRes();
    const client = createServerApiClient(mockReq({ url: '/fr/' }), res, {
      baseUrl: '',
      fetchImpl,
    });
    await client.get('/v1/cart');

    // Factory MUST pass __Host- and __Secure- prefixed cookies through unmodified
    // — both the prefix itself and the SameSite / Secure / HttpOnly attributes.
    const host = res.setCookies.find((c) => c.startsWith('__Host-csrf='));
    const secure = res.setCookies.find((c) => c.startsWith('__Secure-cart='));
    expect(host).toBe('__Host-csrf=abc; Path=/; Secure; SameSite=Strict; HttpOnly');
    expect(secure).toBe('__Secure-cart=42; Path=/; Secure; SameSite=Lax');
  });

  it('falls back to setHeader/array-merge when appendHeader is unavailable', async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: [
            ['content-type', 'application/json'],
            ['set-cookie', 'a=1; Path=/'],
            ['set-cookie', 'b=2; Path=/'],
          ],
        }),
    );
    const res = mockRes({ withAppendHeader: false });
    const client = createServerApiClient(mockReq({ url: '/fr/' }), res, {
      baseUrl: '',
      fetchImpl,
    });
    await client.get('/v1/me');

    // Strict order — the API can rotate refresh + sessionId in two cookies
    // and the second can overwrite a stale value via attribute precedence;
    // reversing the order at the merge boundary would silently break that.
    expect(res.getHeader('set-cookie')).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('prefers req.originalUrl over req.url for locale derivation', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    // Simulates a Nitro / proxy rewrite where `req.url` has been mutated to a
    // locale-less internal path but `req.originalUrl` still carries the
    // user-facing locale prefix. Locale must follow the original URL so the
    // user-visible route stays the source of truth.
    const req = mockReq({ url: '/_internal/render', originalUrl: '/fr/catalog' });
    const client = createServerApiClient(req, mockRes(), { baseUrl: '', fetchImpl });
    await client.get('/v1/products');

    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe('fr');
  });

  // ── SSR locale split-brain regression: the "/en/ renders the wrong language" bug ──
  // At Analog's Nitro page-endpoint layer the inbound url is the INTERNAL
  // `/api/_analog/pages/<locale>/...` path (h3 sets originalUrl = url for the
  // synthetic internal fetch), NOT the user-facing `/{locale}/...` route.
  // `localeFromPathname` is start-anchored on `/{locale}/`, so it reads that
  // url as null and the factory falls back to DEFAULT_LOCALE='fr', which means
  // every /en/ SSR data fetch asks the API for the default locale instead of
  // the requested one. The fix: page loaders pass
  // the authoritative `[locale]` route param via `options.locale`. These tests
  // use the REAL internal-endpoint url shape, which the suite never had before.
  const INTERNAL_ANALOG_URL = '/api/_analog/pages/en/policies/privacy';

  it('reproduces the failure mode: no options.locale + internal _analog url falls back to ar', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const req = mockReq({ url: INTERNAL_ANALOG_URL, originalUrl: INTERNAL_ANALOG_URL });
    const client = createServerApiClient(req, mockRes(), { baseUrl: '', fetchImpl });
    await client.get('/v1/pages/privacy-policy');

    // Locks the documented bug: the url parse cannot read the locale here, so
    // an /en page would (wrongly) fetch the default locale when no route param is passed.
    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe('fr');
  });

  it('options.locale (en) overrides the misleading internal _analog url', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const req = mockReq({ url: INTERNAL_ANALOG_URL, originalUrl: INTERNAL_ANALOG_URL });
    const client = createServerApiClient(req, mockRes(), {
      baseUrl: '',
      fetchImpl,
      locale: 'en',
    });
    await client.get('/v1/pages/privacy-policy');

    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe('en');
  });

  it('options.locale (ar) is honoured on the internal _analog url (mirror)', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const req = mockReq({ url: INTERNAL_ANALOG_URL, originalUrl: INTERNAL_ANALOG_URL });
    const client = createServerApiClient(req, mockRes(), {
      baseUrl: '',
      fetchImpl,
      locale: 'fr',
    });
    await client.get('/v1/pages/privacy-policy');

    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe('fr');
  });

  it('options.locale wins over a clean /{locale}/ url too (route param is the SSOT)', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    // Even when req.url DOES carry a locale prefix, the explicit route param
    // takes precedence — the param is the SSOT, url parse is only the fallback.
    const req = mockReq({ url: '/fr/catalog', originalUrl: '/fr/catalog' });
    const client = createServerApiClient(req, mockRes(), {
      baseUrl: '',
      fetchImpl,
      locale: 'en',
    });
    await client.get('/v1/products');

    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe('en');
  });

  it('null options.locale falls through to url parse (Angular SSR-DI provider path intact)', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    // The DI provider passes no locale; routeLocale(params) also returns null
    // for a malformed/absent param. Both must fall back to the clean url so the
    // chrome-serving provider call site keeps resolving locale correctly.
    const req = mockReq({ url: '/en/catalog', originalUrl: '/en/catalog' });
    const client = createServerApiClient(req, mockRes(), {
      baseUrl: '',
      fetchImpl,
      locale: null,
    });
    await client.get('/v1/products');

    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe('en');
  });

  it('surfaces 401 from the API as a non-retried StorefrontUnauthorizedError', async () => {
    let callCount = 0;
    const { fetchImpl } = mockFetch(() => {
      callCount += 1;
      return new Response(
        JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'no session' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    });
    const client = createServerApiClient(mockReq({ url: '/fr/' }), mockRes(), {
      baseUrl: '',
      fetchImpl,
    });

    await expect(client.get('/v1/me')).rejects.toBeInstanceOf(StorefrontUnauthorizedError);
    // Single attempt — never retried by the SSR client (no refresh wrapper).
    expect(callCount).toBe(1);
  });

  it('does not import the browser-only auth-fetch refresh wrapper', () => {
    const factorySource = readFileSync(
      resolve(__dirname, '../server/server-api-client-factory.ts'),
      'utf8',
    );
    // Strip block + line comments so regex matches code only — the JSDoc
    // legitimately references `withAuthFetch` to explain WHY it is absent.
    const code = factorySource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/services\/auth-fetch/);
    expect(code).not.toMatch(/withAuthFetch/);
    // And no actual import binding to the wrapper.
    expect(code).not.toMatch(/^\s*import[\s\S]*auth-fetch/m);
  });

  it('exposes SSR_API_BASE_URL as a module-scope constant (read once, not per request)', () => {
    // The constant is read at module load — assert the binding exists and is
    // either undefined or a string. The value itself is environment-driven.
    expect(typeof SSR_API_BASE_URL === 'string' || SSR_API_BASE_URL === undefined).toBe(true);
  });
});

describe('app.config.server.ts wiring', () => {
  it('removes the false JSDoc claim from app.config.ts (closed in SH1.5)', () => {
    const source = readFileSync(resolve(__dirname, 'app.config.ts'), 'utf8');
    expect(source).not.toMatch(/this fallback is overridden by the request-scoped provider/);
  });

  it('declares the STOREFRONT_API_CLIENT provider in app.config.server.ts', () => {
    const source = readFileSync(resolve(__dirname, 'app.config.server.ts'), 'utf8');
    expect(source).toMatch(/STOREFRONT_API_CLIENT/);
    expect(source).toMatch(/createServerApiClient/);
    expect(source).toMatch(/injectRequest/);
    expect(source).toMatch(/injectResponse/);
  });
});
