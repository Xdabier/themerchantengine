import { mapHttpErrorToStorefrontError } from '@storefront-types';
import {
  DEFAULT_STOREFRONT_LOCALE,
  STOREFRONT_LOCALES,
  type ApiClient,
  type RequestOptions,
  type StorefrontLocale,
} from './api-client.token';

/**
 * Browser-side `ApiClient` binding. Runs in the storefront client bundle after
 * hydration. Uses `fetch` with `credentials: 'include'` so the browser
 * automatically attaches the Better Auth session cookie the API set on the
 * storefront origin during sign-in (DR-24). There is no JS-readable token —
 * the session lives entirely inside the `HttpOnly` cookie.
 *
 * The locale is read on every request from the `<html lang>` attribute (set by
 * `LocaleService` in `apps/storefront/src/app/locale.service.ts`), because the
 * client is a root singleton that outlives a locale switch or a late `lang`.
 * If the attribute is missing or unrecognised the binding falls back to
 * `DEFAULT_STOREFRONT_LOCALE`, the neutral runtime config's default. The app's
 * pages always set `<html lang>` from the store config, so this is only reached
 * before any page exists, never on a rendered page.
 */

export interface BrowserApiClientOptions {
  /** API base URL. Defaults to the same origin (relative `/v1/...` paths). */
  baseUrl?: string;
  /** Override locale resolution. Defaults to reading `<html lang>`. */
  locale?: StorefrontLocale;
  /** Inject a custom fetch (used by tests). */
  fetchImpl?: typeof fetch;
  /**
   * Invoked once when a response comes back `401 Unauthorized` — usually
   * because the Better Auth session cookie is missing or expired. There is no
   * refresh to attempt under the cookie-session model; `app.config.ts` wires
   * this to clear the `AuthStateService` and bounce to the login page. The
   * typed `StorefrontUnauthorizedError` is still thrown afterwards so the
   * calling page sees the failure.
   *
   * `code` is the envelope's `error.code`, or null when the body carries none.
   * It is passed because not every 401 is session loss: a wrong current
   * password on `PATCH /v1/users/me` answers 401 too, and bouncing on that one
   * throws the customer out of the form they were correcting. The handler
   * needs to tell them apart, and the code is the only thing that can.
   */
  onUnauthorized?: (code: string | null) => void;
}

/**
 * The `error.code` from an API error envelope, or null when the body is not
 * one. Read without the Zod parse: this is a hint for the 401 handler, and a
 * body that fails the envelope shape should read as "no code", never as a
 * throw on the error path.
 */
function errorCodeOf(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Exported so other browser-only transports (the Better Auth client in
 * `auth/auth-client.ts`) can resolve the same locale from the same `<html
 * lang>` source rather than re-deriving it and drifting (constitution §3.11,
 * plan §7 "Locale fallback, four copies").
 */
export function resolveBrowserLocale(override?: StorefrontLocale): StorefrontLocale {
  if (override && STOREFRONT_LOCALES.includes(override)) return override;
  if (typeof document !== 'undefined') {
    const lang = document.documentElement?.getAttribute('lang')?.toLowerCase() ?? '';
    // Derived from the supported list rather than a branch per locale, so
    // adding a locale is one edit in `api-client.token.ts`.
    const matched = STOREFRONT_LOCALES.find((locale) => lang.startsWith(locale));
    if (matched) return matched;
  }
  return DEFAULT_STOREFRONT_LOCALE;
}

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
  // Fallback for ancient runtimes; never hit in modern browsers.
  return `req-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export function createBrowserApiClient(options: BrowserApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function exec<T>(
    method: string,
    path: string,
    body: unknown,
    rawOptions: RequestOptions | undefined,
  ): Promise<T> {
    const requestId = rawOptions?.requestId ?? generateRequestId();
    const locale = resolveBrowserLocale(options.locale);
    const headers = new Headers({
      Accept: 'application/json',
      // Both, and `X-Locale` is the one that works. A page cannot set
      // `Accept-Language`: it is a forbidden header name in the Fetch
      // standard, Chromium relaxed that and WebKit did not, so on Safari this
      // line is silently dropped and the phone's language reaches the API
      // instead of the shop's. `X-Locale` is what the interceptor reads first.
      // `Accept-Language` stays for any consumer still keyed on it.
      'Accept-Language': locale,
      'X-Locale': locale,
      'X-Request-Id': requestId,
    });
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
        credentials: 'include',
        signal: rawOptions?.signal,
        ...(rawOptions?.keepalive ? { keepalive: true } : {}),
      });
    } catch (cause) {
      throw mapHttpErrorToStorefrontError({
        status: 0,
        body: null,
        correlationId: requestId,
      });
    }

    const correlationId = response.headers.get('X-Request-Id') ?? requestId;
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

    if (response.status === 204) {
      return undefined as T;
    }

    // 304 Not Modified is success in HTTP semantics — the server is telling us
    // our cached value (browser or TanStack-Query side) is still valid. The
    // API defaults `Cache-Control: no-store` (constitution §3.X-A) so the
    // browser should not send `If-None-Match` and 304 should never reach
    // here. This guard is belt-and-suspenders: a leaked 304 must NOT fall
    // through to the `!response.ok` branch and crash the caller with a
    // generic "Could not load X. Please retry." toast. Constitution §3.X-B.
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

    // A 401 usually means the Better Auth session cookie is missing or expired,
    // and under the cookie-session model there is no refresh to attempt. Notify
    // the caller, then fall through to throw the typed
    // StorefrontUnauthorizedError so the calling page still sees the failure.
    //
    // The body is read BEFORE the notification, not after, so the handler is
    // told which 401 this is. Some of them are form validation rather than
    // session loss.
    if (response.status === 401) {
      options.onUnauthorized?.(errorCodeOf(parsed));
    }

    if (!response.ok) {
      throw mapHttpErrorToStorefrontError({
        status: response.status,
        body: parsed,
        correlationId,
        retryAfterSeconds,
      });
    }

    return parsed as T;
  }

  return {
    get: (path, options) => exec('GET', path, undefined, options),
    post: (path, body, options) => exec('POST', path, body, options),
    patch: (path, body, options) => exec('PATCH', path, body, options),
    delete: (path, options) => exec('DELETE', path, undefined, options),
    request: (method, path, body, options) => exec(method.toUpperCase(), path, body, options),
  };
}
