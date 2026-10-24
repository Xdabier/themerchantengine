import { mapHttpErrorToStorefrontError, type MapHttpErrorArgs } from '@storefront-types';
// The locale set comes from its decorator-free source, not the services
// barrel: Nitro bundles this file with plain esbuild, and a value import of
// the barrel drags every decorated Angular service into that bundle.
import { STORE_CONFIG_LOCALES as STOREFRONT_LOCALES } from '@common/store-config-fixtures/store-config-fixture.schema';
import type { ApiClient, RequestOptions, StorefrontLocale } from '@storefront-services';

/**
 * Server-side `ApiClient` factory used by Analog SSR route loaders and server
 * routes. Per-request context (cookies, locale, request-id) is captured from
 * the inbound HTTP request once at the top of a route loader and threaded into
 * `createApiClient(ctx)`. Outbound calls forward the incoming `cookie:` header
 * to the API and pipe any `Set-Cookie` response header back through
 * `ctx.setCookie?.(value)` so the storefront response carries the Better Auth
 * session cookie the API rotates (`updateAge`).
 *
 * Conventions:
 * - `Accept-Language: <ctx.locale>` on every call.
 * - `X-Request-Id: <ctx.requestId ?? crypto.randomUUID()>` on every call.
 * - `X-Requested-With: XMLHttpRequest` on POST / PATCH / DELETE / PUT.
 * - `X-Idempotency-Key: <opts.idempotencyKey>` only when supplied.
 * - Never sends `X-Resolve-Locale` (constitution §3.11 — storefront ALWAYS
 *   resolves; admin opts out, storefront does not).
 */

export interface RequestContext {
  /** Incoming cookie header value, forwarded byte-for-byte to the API. */
  cookieHeader?: string;
  /** Active locale derived from the route prefix (`/fr/*` or `/en/*`). */
  locale: StorefrontLocale;
  /** Request id for log correlation; defaults to crypto.randomUUID() per call. */
  requestId?: string;
  /** Sink for any `Set-Cookie` response headers from the API. */
  setCookie?: (value: string) => void;
}

export interface CreateApiClientOptions {
  /** API base URL. Defaults to `STOREFRONT_API_URL` env var, then `http://localhost:53000`. */
  baseUrl?: string;
  /** Inject a custom fetch (used by tests). */
  fetchImpl?: typeof fetch;
}

/**
 * The build's locale catalogue, not one store's pair.
 *
 * This was the literal `['fr', 'en']`, which is the shape of exactly one
 * install. Every server-rendered request under a third locale threw here and
 * degraded the page, and no guard could see it: a locale code is not a client
 * name, and the two fixtures that ship a French pair never exercised it. The
 * check is a sanity check on a route segment; which of these locales a store
 * actually serves is enforced upstream from its runtime config (plan E2.6).
 */
const VALID_LOCALES: readonly StorefrontLocale[] = STOREFRONT_LOCALES;

function isWriteMethod(method: string): boolean {
  return method === 'POST' || method === 'PATCH' || method === 'DELETE' || method === 'PUT';
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  // Always resolve against `baseUrl` — never honour an absolute URL passed
  // as `path`. Honouring `http(s)://...` would create an SSRF escape hatch
  // if a future caller ever derives `path` from request input.
  const joined = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return joined;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    usp.append(key, String(value));
  }
  const qs = usp.toString();
  if (qs.length === 0) return joined;
  return `${joined}${joined.includes('?') ? '&' : '?'}${qs}`;
}

function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `req-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function pipeSetCookies(response: Response, sink: RequestContext['setCookie']): void {
  if (!sink) return;
  // Node 20+ Response.headers exposes `getSetCookie()`. Fall back to a manual
  // split for older runtimes that surface the raw `Set-Cookie` string.
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies =
    typeof headersWithGetSetCookie.getSetCookie === 'function'
      ? headersWithGetSetCookie.getSetCookie()
      : [];
  if (setCookies.length > 0) {
    for (const value of setCookies) sink(value);
    return;
  }
  const raw = response.headers.get('set-cookie');
  if (raw) sink(raw);
}

export function createApiClient(
  ctx: RequestContext,
  options: CreateApiClientOptions = {},
): ApiClient {
  if (!VALID_LOCALES.includes(ctx.locale)) {
    throw new Error(`createApiClient: unsupported locale "${ctx.locale}"`);
  }

  const baseUrl =
    options.baseUrl ?? process.env['STOREFRONT_API_URL'] ?? 'http://localhost:53000/api';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function exec<T>(
    method: string,
    path: string,
    body: unknown,
    rawOptions: RequestOptions | undefined,
  ): Promise<T> {
    const requestId = rawOptions?.requestId ?? ctx.requestId ?? generateRequestId();
    const headers = new Headers({
      Accept: 'application/json',
      'Accept-Language': ctx.locale,
      'X-Request-Id': requestId,
    });
    if (ctx.cookieHeader) headers.set('Cookie', ctx.cookieHeader);
    if (isWriteMethod(method)) headers.set('X-Requested-With', 'XMLHttpRequest');
    if (rawOptions?.idempotencyKey) headers.set('X-Idempotency-Key', rawOptions.idempotencyKey);
    if (rawOptions?.headers) {
      for (const [key, value] of Object.entries(rawOptions.headers)) headers.set(key, value);
    }

    let serializedBody: BodyInit | undefined;
    if (body !== undefined && body !== null) {
      headers.set('Content-Type', 'application/json');
      serializedBody = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(baseUrl, path, rawOptions?.query), {
        method,
        headers,
        body: serializedBody,
        signal: rawOptions?.signal,
      });
    } catch (cause) {
      throw mapHttpErrorToStorefrontError({
        status: 0,
        body: null,
        correlationId: requestId,
      });
    }

    pipeSetCookies(response, ctx.setCookie);

    const correlationId = response.headers.get('X-Request-Id') ?? requestId;
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

    if (response.status === 204) {
      return undefined as T;
    }

    // SSR opt-in: callers serving auth-aware routes that ALSO render anonymous
    // (e.g. /account, header avatar, cart count) declare `allow401AsNull` so a
    // missing-or-expired Better Auth session cookie produces the anonymous
    // shell on first paint. The browser boot's `getSession()` then resolves
    // the real session after hydration (constitution §3.11.6).
    if (response.status === 401 && rawOptions?.allow401AsNull) {
      return null as T;
    }

    // 304 Not Modified is success in HTTP semantics — the server is telling us
    // the cached value is still valid. The SSR fetch path does not send
    // `If-None-Match`, so 304 should never reach here in practice (the API
    // also defaults `Cache-Control: no-store` per constitution §3.X-A). This
    // guard is belt-and-suspenders: a leaked 304 must NOT fall through to the
    // `!response.ok` branch and crash the loader with a generic error toast.
    if (response.status === 304) {
      return undefined as T;
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const args: MapHttpErrorArgs = {
        status: response.status,
        body: parsed,
        correlationId,
        retryAfterSeconds,
      };
      throw mapHttpErrorToStorefrontError(args);
    }

    return parsed as T;
  }

  const client: ApiClient = {
    get: (path: string, opts?: RequestOptions) => exec('GET', path, undefined, opts),
    post: (path: string, body?: unknown, opts?: RequestOptions) => exec('POST', path, body, opts),
    patch: (path: string, body?: unknown, opts?: RequestOptions) => exec('PATCH', path, body, opts),
    delete: (path: string, opts?: RequestOptions) => exec('DELETE', path, undefined, opts),
    request: (method: string, path: string, body?: unknown, opts?: RequestOptions) =>
      exec(method.toUpperCase(), path, body, opts),
  };
  return client;
}
