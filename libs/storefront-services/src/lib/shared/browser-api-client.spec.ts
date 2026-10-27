import { describe, expect, it, vi } from 'vitest';
import {
  NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
  StorefrontNetworkError,
  StorefrontNotFoundError,
  StorefrontRateLimitError,
  StorefrontUnauthorizedError,
  StorefrontValidationError,
} from '@storefront-types';
import { DEFAULT_STOREFRONT_LOCALE } from './api-client.token';
import { createBrowserApiClient } from './browser-api-client';

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

const okJson = (body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

const errJson = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('createBrowserApiClient', () => {
  it('builds a relative URL against the base and forwards Accept-Language', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: [] }));
    const client = createBrowserApiClient({
      baseUrl: 'http://localhost:53000',
      locale: 'fr',
      fetchImpl,
    });
    await client.get('/v1/products', { query: { page: 1, pageSize: 5 } });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:53000/v1/products?page=1&pageSize=5');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('Accept-Language')).toBe('fr');
    expect(headers.get('X-Requested-With')).toBeNull();
    expect(headers.get('X-Request-Id')).toBeTruthy();
    expect(calls[0].init.credentials).toBe('include');
  });

  it('attaches X-Requested-With + Content-Type on write requests', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    await client.post('/v1/cart/items', { variantId: 'v1', quantity: 1 });

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(calls[0].init.body).toBe(JSON.stringify({ variantId: 'v1', quantity: 1 }));
  });

  it('passes idempotency key through when provided', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { id: 'ord1' } }));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    await client.post(
      '/v1/orders',
      { shippingAddressId: 'addr1' },
      {
        idempotencyKey: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', // gitleaks:allow
      },
    );

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('X-Idempotency-Key')).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  it('forwards keepalive to fetch only when asked', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: null }));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    await client.post('/v1/search/events/e1/click', { clickPosition: 0 }, { keepalive: true });
    await client.post('/v1/cart/items', { variantId: 'v1', quantity: 1 });

    expect(calls[0].init.keepalive).toBe(true);
    expect(calls[1].init.keepalive).toBeUndefined();
  });

  it('uses the supplied requestId when given', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: null }));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    await client.get('/v1/cart', { requestId: 'req-abc' });

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('X-Request-Id')).toBe('req-abc');
  });

  // Constitution §3.X-B: HTTP 304 is HTTP success — the server is telling us
  // the cached value is unchanged. The 2026-05-16 incident traced the
  // "Could not load X. Please retry." cascade to clients throwing on 304
  // because `response.ok === false`. The API now defaults Cache-Control:
  // no-store (constitution §3.X-A) so 304 should not reach here in practice,
  // but this guard prevents a cache-config regression from re-breaking every
  // page.
  it('returns undefined on 304 Not Modified without throwing', async () => {
    const { fetchImpl } = mockFetch(() => new Response(null, { status: 304 }));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    const result = await client.get('/v1/users/me');
    expect(result).toBeUndefined();
  });

  it('returns undefined on 204 No Content', async () => {
    const { fetchImpl } = mockFetch(() => new Response(null, { status: 204 }));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    const result = await client.delete('/v1/cart');
    expect(result).toBeUndefined();
  });

  it('maps 400 with fieldErrors to StorefrontValidationError', async () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        details: { fieldErrors: { email: ['must be email'] } },
      },
    };
    const { fetchImpl } = mockFetch(() => errJson(400, body));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    await expect(client.post('/v1/auth/login', {})).rejects.toBeInstanceOf(
      StorefrontValidationError,
    );
  });

  it('maps 401 to StorefrontUnauthorizedError', async () => {
    const { fetchImpl } = mockFetch(() => errJson(401, { error: { code: 'AUTH', message: 'no' } }));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    await expect(client.get('/v1/users/me')).rejects.toBeInstanceOf(StorefrontUnauthorizedError);
  });

  it('invokes onUnauthorized exactly once on a 401, then still throws', async () => {
    let calls = 0;
    const { fetchImpl } = mockFetch(() => errJson(401, { error: { code: 'AUTH', message: 'no' } }));
    const client = createBrowserApiClient({
      baseUrl: '',
      locale: 'en',
      fetchImpl,
      onUnauthorized: () => {
        calls += 1;
      },
    });
    await expect(client.get('/v1/users/me')).rejects.toBeInstanceOf(StorefrontUnauthorizedError);
    expect(calls).toBe(1);
  });

  it('hands onUnauthorized the error code so the caller can tell 401s apart', async () => {
    // The global handler signs the customer out on a 401. A wrong current
    // password answers 401 too, and bouncing on that one throws them out of
    // the form they were correcting. The code is the only thing that separates
    // "your session is gone" from "that field is wrong".
    const seen: (string | null)[] = [];
    const { fetchImpl } = mockFetch(() =>
      errJson(401, { error: { code: 'PROFILE_CURRENT_PASSWORD_INCORRECT', message: 'no' } }),
    );
    const client = createBrowserApiClient({
      baseUrl: '',
      locale: 'en',
      fetchImpl,
      onUnauthorized: (code) => {
        seen.push(code);
      },
    });

    await expect(client.patch('/v1/users/me', {})).rejects.toBeInstanceOf(
      StorefrontUnauthorizedError,
    );
    expect(seen).toEqual(['PROFILE_CURRENT_PASSWORD_INCORRECT']);
  });

  it('hands onUnauthorized null when the 401 body carries no code', async () => {
    const seen: (string | null)[] = [];
    const { fetchImpl } = mockFetch(() => new Response('', { status: 401 }));
    const client = createBrowserApiClient({
      baseUrl: '',
      locale: 'en',
      fetchImpl,
      onUnauthorized: (code) => {
        seen.push(code);
      },
    });

    await expect(client.get('/v1/users/me')).rejects.toBeInstanceOf(StorefrontUnauthorizedError);
    expect(seen).toEqual([null]);
  });

  it('does not invoke onUnauthorized on a non-401 error', async () => {
    let called = false;
    const { fetchImpl } = mockFetch(() =>
      errJson(404, { error: { code: 'NOT_FOUND', message: 'no' } }),
    );
    const client = createBrowserApiClient({
      baseUrl: '',
      locale: 'en',
      fetchImpl,
      onUnauthorized: () => {
        called = true;
      },
    });
    await expect(client.get('/v1/products/nope')).rejects.toBeInstanceOf(StorefrontNotFoundError);
    expect(called).toBe(false);
  });

  it('maps 404 to StorefrontNotFoundError', async () => {
    const { fetchImpl } = mockFetch(() =>
      errJson(404, { error: { code: 'NOT_FOUND', message: 'no' } }),
    );
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    await expect(client.get('/v1/products/nope')).rejects.toBeInstanceOf(StorefrontNotFoundError);
  });

  it('maps 429 with Retry-After to StorefrontRateLimitError carrying retry seconds', async () => {
    const body = { error: { code: 'RATE_LIMIT', message: 'slow' } };
    const { fetchImpl } = mockFetch(() => errJson(429, body, { 'Retry-After': '30' }));
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    try {
      await client.get('/v1/search/suggest', { query: { q: 'x' } });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(StorefrontRateLimitError);
      expect((err as StorefrontRateLimitError).retryAfter).toBe(30);
    }
  });

  it('maps a fetch failure to StorefrontNetworkError', async () => {
    const { fetchImpl } = mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const client = createBrowserApiClient({ baseUrl: '', locale: 'en', fetchImpl });
    await expect(client.get('/v1/products')).rejects.toBeInstanceOf(StorefrontNetworkError);
  });

  it('locale fallback returns the default locale when document is unavailable', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: [] }));
    // Construct without explicit locale; Node test env has no `document`.
    const client = createBrowserApiClient({ baseUrl: '', fetchImpl });
    await client.get('/v1/products');
    expect(new Headers(calls[0].init.headers).get('Accept-Language')).toBe(
      DEFAULT_STOREFRONT_LOCALE,
    );
    expect(DEFAULT_STOREFRONT_LOCALE).toBe(
      NEUTRAL_STOREFRONT_RUNTIME_CONFIG.localization.defaultLocale,
    );
  });

  it('reads <html lang> per request, not once at construction', async () => {
    // The client is a root singleton built at bootstrap. A lang that is set or
    // changed after that (client render, locale switch) must still reach the API.
    let lang: string | null = null;
    vi.stubGlobal('document', { documentElement: { getAttribute: () => lang } });
    try {
      const { fetchImpl, calls } = mockFetch(() => okJson({ data: [] }));
      const client = createBrowserApiClient({ baseUrl: '', fetchImpl });
      lang = 'en';
      await client.get('/v1/categories');
      lang = 'fr';
      await client.get('/v1/categories');
      expect(calls.map((c) => new Headers(c.init.headers).get('X-Locale'))).toEqual(['en', 'fr']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
