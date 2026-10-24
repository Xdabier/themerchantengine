import type { ServerRequest, ServerResponse } from '@analogjs/router/tokens';
import type { ApiClient, StorefrontLocale } from '@storefront-services';

import { localeFromPathname } from '../lib/locale';
import { DEFAULT_LOCALE } from '../i18n/types';
import { createApiClient, type RequestContext } from './api-client';

/**
 * SSR-side `STOREFRONT_API_CLIENT` factory bound to the inbound h3 event.
 *
 * Keeps the request-scoped wiring out of `app.config.server.ts` so it is
 * unit-testable with mock `IncomingMessage` / `ServerResponse` shells (no
 * Analog runtime required). The provider in `app.config.server.ts` is now a
 * one-liner that injects `ServerRequest` + `ServerResponse` and delegates here.
 *
 * Contract per `agent_docs/storefront/ssr-data-loading.md`
 * `## Server-side STOREFRONT_API_CLIENT provider`:
 * - `cookieHeader` forwarded byte-for-byte from `req.headers.cookie`.
 * - `locale` is the matched `[locale]` route param (`options.locale`, the
 *   SSOT — see `routeLocale` in `lib/locale.ts`). It falls back to the URL
 *   prefix (`/fr/*` or `/en/*`) ONLY for the Angular SSR-DI provider call site,
 *   whose injected `req.url` IS the clean `/{locale}/...` request, then to
 *   `DEFAULT_LOCALE`. NEVER from `Accept-Language`. The URL parse cannot be the
 *   SSOT inside a Nitro page endpoint: there `req.url` is the internal
 *   `/api/_analog/pages/<locale>/...` path, which `localeFromPathname` (start-
 *   anchored on `/{locale}/`) reads as null, so every SSR fetch would fall
 *   back to `DEFAULT_LOCALE` and serve the wrong language on `/en/`. That is
 *   the SSR locale-leak defect, and `options.locale` is what closes it.
 * - `requestId` propagated from the inbound `x-request-id` header; absent →
 *   `crypto.randomUUID()` per call by the underlying `createApiClient`.
 * - `setCookie` pipes any `Set-Cookie` from the API response back through to
 *   the storefront response so refresh-rotated cookies reach the user.
 * - The factory MUST NOT cache an `ApiClient` across requests; cookies and
 *   request IDs are request-scoped.
 * - The factory MUST NOT import `withAuthFetch` — SSR never invokes the
 *   browser-only refresh wrapper. 401 surfaces unretried per
 *   `agent_docs/storefront/ssr-data-loading.md` `## Auth boundary`.
 */

/**
 * Read once at module scope. The provider closes over this so the per-request
 * factory does not re-resolve the env on every render.
 */
export const SSR_API_BASE_URL: string | undefined = process.env['STOREFRONT_API_URL'];

function readRequestId(req: ServerRequest): string | undefined {
  const raw = req.headers['x-request-id'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

function makeSetCookieSink(res: ServerResponse): (value: string) => void {
  return (value: string): void => {
    // Node 16.17+ exposes `appendHeader` on ServerResponse — preferred because
    // `setHeader('set-cookie', ...)` overwrites and the API may return
    // multiple Set-Cookie values across calls within one render. Fall back to
    // a manual array-merge for older runtimes (no longer hit in supported
    // Node 20 deployments but safe to keep).
    const resWithAppendHeader = res as ServerResponse & {
      appendHeader?: (n: string, v: string) => void;
    };
    if (typeof resWithAppendHeader.appendHeader === 'function') {
      resWithAppendHeader.appendHeader('set-cookie', value);
      return;
    }
    const existing = res.getHeader('set-cookie');
    if (existing === undefined) {
      res.setHeader('set-cookie', value);
    } else if (Array.isArray(existing)) {
      res.setHeader('set-cookie', [...existing, value]);
    } else {
      res.setHeader('set-cookie', [String(existing), value]);
    }
  };
}

export interface CreateServerApiClientOptions {
  /** API base URL. Defaults to `SSR_API_BASE_URL` (env), then the api-client default. */
  baseUrl?: string;
  /** Inject a custom fetch (used by tests). */
  fetchImpl?: typeof fetch;
  /**
   * Authoritative request locale from the matched `[locale]` route param.
   * Takes precedence over `req.url` parsing because at the Nitro page-endpoint
   * layer the inbound url is the internal `/api/_analog/pages/<locale>/...`
   * path — `localeFromPathname` (start-anchored on `/{locale}/`) cannot read it
   * and would fall back to `DEFAULT_LOCALE`. Omitted only by the
   * Angular SSR-DI provider, whose injected request IS the clean
   * `/{locale}/...` URL. Pass it via `routeLocale(params)` in every loader.
   */
  locale?: StorefrontLocale | null;
}

/**
 * Build a request-scoped storefront `ApiClient` from the inbound h3 event.
 * Always returns a fresh client — no caching across requests.
 */
export function createServerApiClient(
  req: ServerRequest,
  res: ServerResponse,
  options: CreateServerApiClientOptions = {},
): ApiClient {
  const cookieHeader = req.headers.cookie;
  // Route param wins (the SSOT). URL parse is the fallback for the Angular
  // SSR-DI provider path, whose `req.url` is already the clean `/{locale}/...`
  // request; `DEFAULT_LOCALE` last. See the contract JSDoc above for why the
  // URL parse cannot lead at the Nitro page-endpoint layer.
  const locale =
    options.locale ?? localeFromPathname(req.originalUrl ?? req.url ?? '') ?? DEFAULT_LOCALE;
  const requestId = readRequestId(req);

  const ctx: RequestContext = {
    cookieHeader,
    locale,
    requestId,
    setCookie: makeSetCookieSink(res),
  };

  return createApiClient(ctx, {
    baseUrl: options.baseUrl ?? SSR_API_BASE_URL,
    fetchImpl: options.fetchImpl,
  });
}
