import { describe, expect, it } from 'vitest';
import {
  StorefrontConflictError,
  StorefrontForbiddenError,
  StorefrontNetworkError,
  StorefrontRateLimitError,
  StorefrontServerError,
  StorefrontUnauthorizedError,
  StorefrontValidationError,
} from '@storefront-types';
import { createApiClient, type RequestContext } from './api-client';
import { STOREFRONT_LOCALES } from '@storefront-services';

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

const baseCtx = (overrides: Partial<RequestContext> = {}): RequestContext => ({
  locale: 'fr',
  requestId: 'req-fixture',
  ...overrides,
});

describe('createApiClient', () => {
  it('builds URL, attaches Accept-Language + Request-Id, no write headers on GET', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: [] }));
    const client = createApiClient(baseCtx({ locale: 'en' }), {
      baseUrl: 'http://localhost:53000',
      fetchImpl,
    });
    await client.get('/v1/products', { query: { page: 1, pageSize: 5 } });

    expect(calls[0].url).toBe('http://localhost:53000/v1/products?page=1&pageSize=5');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('Accept-Language')).toBe('en');
    expect(headers.get('X-Request-Id')).toBe('req-fixture');
    expect(headers.get('X-Requested-With')).toBeNull();
  });

  it('forwards the incoming cookie header to the API', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const ctx = baseCtx({ cookieHeader: 'sessionId=abc; refreshToken=xyz' });
    const client = createApiClient(ctx, { baseUrl: '', fetchImpl });
    await client.get('/v1/cart');

    expect(new Headers(calls[0].init.headers).get('Cookie')).toBe(
      'sessionId=abc; refreshToken=xyz',
    );
  });

  it('does not set X-Resolve-Locale (storefront never opts out)', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: [] }));
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    await client.get('/v1/categories');

    expect(new Headers(calls[0].init.headers).get('X-Resolve-Locale')).toBeNull();
  });

  it('attaches X-Requested-With + Content-Type on writes and serializes body', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { ok: true } }));
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    await client.post('/v1/cart/items', { variantId: 'v1', quantity: 2 });

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(calls[0].init.body).toBe(JSON.stringify({ variantId: 'v1', quantity: 2 }));
  });

  it('threads X-Idempotency-Key when provided', async () => {
    const { fetchImpl, calls } = mockFetch(() => okJson({ data: { id: 'ord1' } }));
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    await client.post(
      '/v1/orders',
      { shippingAddressId: 'a1' },
      {
        idempotencyKey: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', // gitleaks:allow
      },
    );

    expect(new Headers(calls[0].init.headers).get('X-Idempotency-Key')).toBe(
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    );
  });

  it('pipes Set-Cookie back through ctx.setCookie', async () => {
    const captured: string[] = [];
    const { fetchImpl } = mockFetch(() =>
      okJson(
        { data: { accessToken: 'jwt' } },
        { 'set-cookie': 'refreshToken=new-rt; HttpOnly; Path=/v1/auth' },
      ),
    );
    const ctx = baseCtx({ setCookie: (value) => captured.push(value) });
    const client = createApiClient(ctx, { baseUrl: '', fetchImpl });
    await client.post('/v1/auth/refresh');

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.join(';')).toContain('refreshToken=new-rt');
  });

  it('returns undefined on 204 No Content', async () => {
    const { fetchImpl } = mockFetch(() => new Response(null, { status: 204 }));
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    const result = await client.delete('/v1/cart');
    expect(result).toBeUndefined();
  });

  // Constitution §3.X-B: HTTP 304 is HTTP success — the server is telling us
  // the cached value is unchanged. The 2026-05-16 incident traced the
  // "Could not load X. Please retry." cascade to clients throwing
  // StorefrontError on 304 because `response.ok === false`. The API now
  // defaults `Cache-Control: no-store` (constitution §3.X-A) so 304 should
  // not reach here in practice, but this guard prevents a cache-config
  // regression from re-breaking every page.
  it('returns undefined on 304 Not Modified without throwing', async () => {
    const { fetchImpl } = mockFetch(() => new Response(null, { status: 304 }));
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    const result = await client.get('/v1/users/me');
    expect(result).toBeUndefined();
  });

  it('maps 400 with fieldErrors to StorefrontValidationError', async () => {
    const { fetchImpl } = mockFetch(() =>
      errJson(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid',
          details: { fieldErrors: { email: ['must be email'] } },
        },
      }),
    );
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    await expect(client.post('/v1/auth/login', {})).rejects.toBeInstanceOf(
      StorefrontValidationError,
    );
  });

  it('maps 401, 403, 409 to typed errors', async () => {
    const cases: Array<[number, unknown]> = [
      [401, StorefrontUnauthorizedError],
      [403, StorefrontForbiddenError],
      [409, StorefrontConflictError],
    ];
    for (const [status, ctor] of cases) {
      const { fetchImpl } = mockFetch(() =>
        errJson(status, { error: { code: 'X', message: 'X' } }),
      );
      const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
      await expect(client.get('/v1/test')).rejects.toBeInstanceOf(ctor as never);
    }
  });

  it('returns null on 401 when allow401AsNull is set (SSR auth-aware loader)', async () => {
    // SSR loaders for routes that ALSO render anonymous (header avatar,
    // cart count, /account) opt into 401-as-null so the first paint is the
    // anonymous shell. Hydration then recovers the session via the browser
    // refresh path.
    const { fetchImpl, calls } = mockFetch(() =>
      errJson(401, { error: { code: 'UNAUTHORIZED', message: '' } }),
    );
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    const result = await client.get('/v1/users/me', { allow401AsNull: true });
    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('still throws on 401 when allow401AsNull is NOT set (default)', async () => {
    // Default behaviour for the 99% of endpoints whose loaders should fail
    // hard on 401 — the surrounding route boundary handles the redirect.
    const { fetchImpl } = mockFetch(() =>
      errJson(401, { error: { code: 'UNAUTHORIZED', message: '' } }),
    );
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    await expect(client.get('/v1/users/me')).rejects.toBeInstanceOf(StorefrontUnauthorizedError);
  });

  it('does not coerce non-401 errors to null even with allow401AsNull set', async () => {
    // Boundary case: allow401AsNull is narrowly scoped to 401. A 500 from
    // the same loader still surfaces as a real error so the route shell can
    // render the error boundary.
    const { fetchImpl } = mockFetch(() =>
      errJson(500, { error: { code: 'INTERNAL', message: '' } }),
    );
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    await expect(client.get('/v1/users/me', { allow401AsNull: true })).rejects.toBeInstanceOf(
      StorefrontServerError,
    );
  });

  it('maps 429 with Retry-After to StorefrontRateLimitError', async () => {
    const { fetchImpl } = mockFetch(() =>
      errJson(429, { error: { code: 'RATE_LIMIT', message: 'slow' } }, { 'Retry-After': '15' }),
    );
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    try {
      await client.get('/v1/search/suggest', { query: { q: 'x' } });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(StorefrontRateLimitError);
      expect((err as StorefrontRateLimitError).retryAfter).toBe(15);
    }
  });

  it('maps 500 to StorefrontServerError', async () => {
    const { fetchImpl } = mockFetch(() =>
      errJson(500, { error: { code: 'INTERNAL', message: 'oops' } }),
    );
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    await expect(client.get('/v1/products')).rejects.toBeInstanceOf(StorefrontServerError);
  });

  it('maps a fetch failure to StorefrontNetworkError', async () => {
    const { fetchImpl } = mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const client = createApiClient(baseCtx(), { baseUrl: '', fetchImpl });
    await expect(client.get('/v1/products')).rejects.toBeInstanceOf(StorefrontNetworkError);
  });

  it('rejects a locale the build does not ship at construction', () => {
    expect(() => createApiClient({ locale: 'de' as unknown as 'fr' }, { baseUrl: '' })).toThrow(
      /unsupported locale/,
    );
  });

  it('accepts every locale the build ships', () => {
    // The positive half. This guard held the literal pair `['fr', 'en']`, so a
    // store serving the third catalogue locale threw on every server-rendered
    // request. Asserting the rejection alone could never have caught that.
    for (const locale of STOREFRONT_LOCALES) {
      expect(() => createApiClient({ locale }, { baseUrl: '' }), locale).not.toThrow();
    }
  });
});
