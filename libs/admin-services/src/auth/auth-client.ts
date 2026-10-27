import { InjectionToken, inject } from '@angular/core';
import { createAuthClient } from 'better-auth/client';
import { twoFactorClient, magicLinkClient } from 'better-auth/client/plugins';
import { ADMIN_API_BASE_URL } from '../shared';

/**
 * Resolve the absolute Better Auth base URL from the admin's API base.
 *
 * Better Auth's client (`@better-fetch/fetch`) rejects a relative `baseURL`:
 * `withPath()` runs `new URL(url)` and throws unless the URL carries an
 * `http(s)://` protocol. `ADMIN_API_BASE_URL` is `/api` in dev (a same-origin
 * proxy to the API) and an absolute origin in prod, so both are normalised to
 * an absolute URL here. Keeping dev traffic on the same-origin `/api` proxy
 * also keeps the session cookie scoped to the admin's own origin.
 */
export function authBaseUrl(apiBaseUrl: string): string {
  const root = apiBaseUrl.startsWith('http')
    ? apiBaseUrl
    : `${globalThis.location?.origin ?? ''}${apiBaseUrl}`;
  return `${root.replace(/\/+$/, '')}/v1/auth`;
}

/**
 * The admin's Better Auth client — the vanilla `better-auth/client` with the
 * `twoFactor` + `magicLink` plugin clients. `@better-fetch/fetch` sends
 * `credentials: 'include'` by default, so the `HttpOnly` session cookie rides
 * every call without extra configuration.
 */
export function createAdminAuthClient(apiBaseUrl: string) {
  return createAuthClient({
    baseURL: authBaseUrl(apiBaseUrl),
    plugins: [twoFactorClient(), magicLinkClient()],
  });
}

export type AdminAuthClient = ReturnType<typeof createAdminAuthClient>;

/**
 * DI token for the Better Auth client. The factory wires it from
 * `ADMIN_API_BASE_URL`; unit tests override the token with a fake client so
 * no real network stack is constructed.
 */
export const ADMIN_AUTH_CLIENT = new InjectionToken<AdminAuthClient>('ADMIN_AUTH_CLIENT', {
  providedIn: 'root',
  factory: () => createAdminAuthClient(inject(ADMIN_API_BASE_URL)),
});
