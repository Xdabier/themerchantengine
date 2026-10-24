import { InjectionToken } from '@angular/core';
import {
  NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
  StorefrontError,
  type MapHttpErrorArgs,
} from '@storefront-types';
import { STORE_CONFIG_LOCALES } from '@common/store-config-fixtures/store-config-fixture.schema';

/**
 * Transport-agnostic interface every storefront Angular service consumes. The
 * server binding (Analog SSR / server route loaders) is wired by
 * `apps/storefront/src/server/api-client.ts` (`createApiClient(ctx, opts?)`).
 * The browser binding ships in `browser-api-client.ts` next to this file.
 *
 * Methods return the raw JSON envelope returned by the API; the calling
 * service is responsible for parsing it through the matching Zod schema before
 * returning data to its callers.
 */

/**
 * Locales the storefront transport layer will send in `Accept-Language`.
 *
 * Taken from the shared locale catalogue rather than restated. It used to be a
 * literal pair duplicated from the app, on the grounds that this library must
 * not depend on the app, with a parity spec as the guard against drift. The
 * catalogue lives in `libs/shared/common` now, which both may depend on, so
 * there is one definition and nothing left to drift.
 *
 * This is the build's catalogue, not one store's locale set: which of these a
 * store serves comes from its runtime config.
 */
export const STOREFRONT_LOCALES = STORE_CONFIG_LOCALES;
export type StorefrontLocale = (typeof STOREFRONT_LOCALES)[number];

/**
 * The locale assumed when nothing on the page identifies one, and no config
 * has been read: the neutral config's default. A last resort, not a policy.
 */
export const DEFAULT_STOREFRONT_LOCALE: StorefrontLocale =
  NEUTRAL_STOREFRONT_RUNTIME_CONFIG.localization.defaultLocale;

/** Per-method options threaded into the underlying fetch call. */
export interface RequestOptions {
  /** Optional `X-Idempotency-Key` header value (UUID v4 for `POST /v1/orders`). */
  idempotencyKey?: string;
  /** Optional override of the request-scoped request id (echoed back via `X-Request-Id`). */
  requestId?: string;
  /** Optional URLSearchParams entries appended to the URL. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Optional `AbortSignal` for cancellation. */
  signal?: AbortSignal;
  /**
   * Browser-only: send as a `keepalive` fetch so a page unload cannot abort
   * it. For fire-and-forget beacons sent from a click that navigates away.
   */
  keepalive?: boolean;
  /**
   * Extra per-request headers, merged over the standard set. Used to carry the
   * bot-protection signals (`x-captcha-response`, `x-hp-field`) on public form
   * POSTs (newsletter subscribe) without polluting the JSON body.
   */
  headers?: Record<string, string>;
  /**
   * SSR-only: when true, a `401 Unauthorized` response resolves the call with
   * `null` instead of throwing `StorefrontUnauthorizedError`. Used by route
   * loaders for endpoints that are valid-without-auth (e.g. /v1/users/me on a
   * page that also renders for anonymous visitors). The SSR pass yields a
   * graceful anonymous shell; the browser boot's Better Auth `getSession()`
   * then resolves the real session after hydration.
   *
   * Browser-side bindings ignore this flag — a 401 there means the session
   * cookie is gone, which the browser API client surfaces (clear + redirect).
   */
  allow401AsNull?: boolean;
}

export interface ApiClient {
  get<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  /** Escape hatch for non-JSON or non-envelope endpoints (sitemap, robots). */
  request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T>;
}

/** Angular `InjectionToken` services use to receive the active `ApiClient`. */
export const STOREFRONT_API_CLIENT = new InjectionToken<ApiClient>('STOREFRONT_API_CLIENT');

/**
 * Helper re-export so `apps/storefront/src/server/api-client.ts` can stay
 * decoupled from the lib's other re-exports.
 */
export { StorefrontError };
export type { MapHttpErrorArgs };
