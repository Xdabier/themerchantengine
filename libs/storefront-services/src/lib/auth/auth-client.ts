import { InjectionToken } from '@angular/core';
import { createAuthClient } from 'better-auth/client';
import { inferAdditionalFields, magicLinkClient } from 'better-auth/client/plugins';

import { resolveBrowserLocale } from '../shared/browser-api-client';

/**
 * Resolve the absolute Better Auth base URL for the storefront browser.
 *
 * `@better-fetch/fetch` (the Better Auth client transport) rejects a relative
 * `baseURL` — `withPath()` runs `new URL(url)` and throws without an
 * `http(s)://` protocol. The storefront browser reaches the API at the
 * same-origin `/v1/*` path: the Vite dev proxy and the production storefront
 * nginx both rewrite `/v1/*` onto the API. So the absolute base is the current
 * origin + `/v1/auth`. The session cookie Better Auth issues at `Path=/` rides
 * every same-origin call (`credentials: 'include'` is the client default).
 *
 * On the server `globalThis.location` is undefined. The Better Auth client is
 * browser-only — `layout-shell.boot()` is `isPlatformBrowser`-gated and the
 * auth pages call it on user interaction, never during SSR or prerender
 * (BA4.1 handling of better-auth issue #5020). The `http://localhost` fallback
 * only keeps `createAuthClient` construction from throwing if the token's root
 * factory is touched in a server injector; the client is never called there.
 */
export function storefrontAuthBaseUrl(): string {
  const origin = globalThis.location?.origin ?? 'http://localhost';
  return `${origin}/v1/auth`;
}

/**
 * The storefront's Better Auth client — the vanilla `better-auth/client` with
 * the `magicLink` plugin. Clarification Q3: storefront customers get
 * password-less magic-link sign-in; TOTP 2FA stays admin-only, so no
 * `twoFactor` client plugin ships here.
 *
 * `inferAdditionalFields` declares the `firstName` / `lastName` fields the API
 * adds to the Better Auth `user` model (clarification Q4) so `signUp.email`
 * accepts them type-safely — without pulling the server `auth` type, and the
 * NestJS code it imports, into the storefront client bundle.
 */
/**
 * Headers every Better Auth call must carry, plus whatever the caller adds.
 *
 * The client-level `fetchOptions.headers` below is a *default*, and the
 * underlying fetch merges per-call options shallowly: a call that passes its
 * own `fetchOptions.headers` replaces the default outright rather than adding
 * to it. Sign-up does exactly that, for the honeypot and captcha headers, and
 * silently lost the locale that way. Route every per-call header set through
 * here so the locale cannot be dropped by adding one.
 */
export function storefrontAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const locale = resolveBrowserLocale();
  // `X-Locale` is the one a browser will actually send: `Accept-Language` is a
  // forbidden header name in the Fetch standard and WebKit still enforces it,
  // so setting it from a page is a no-op on Safari. Both go out; the API reads
  // `X-Locale` first.
  return { 'Accept-Language': locale, 'X-Locale': locale, ...extra };
}

export function createStorefrontAuthClient(baseUrl?: string) {
  return createAuthClient({
    baseURL: baseUrl ?? storefrontAuthBaseUrl(),
    // `@better-fetch/fetch` sends the browser's default `Accept-Language`
    // (whatever the OS or browser is set to) unless told otherwise, which is a
    // locale leak: SSR renders the resolved app locale, then this client's
    // `get-session` call, the first browser-side `/v1/*` call on almost every
    // page, asks the API for a language the user never chose.
    // `resolveBrowserLocale()` reads the same `<html lang>` source
    // `browser-api-client.ts` uses, so both transports agree. Set per request
    // in `onRequest`: the client is a root singleton that outlives a locale
    // switch, and a static default would freeze the locale at construction.
    fetchOptions: {
      onRequest: (context) => {
        for (const [key, value] of Object.entries(storefrontAuthHeaders())) {
          context.headers.set(key, value);
        }
        return context;
      },
    },
    plugins: [
      magicLinkClient(),
      inferAdditionalFields({
        user: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      }),
    ],
  });
}

export type StorefrontAuthClient = ReturnType<typeof createStorefrontAuthClient>;

/**
 * DI token for the Better Auth client. The root factory wires the real client;
 * unit tests override the token with a fake so no network stack is built.
 */
export const STOREFRONT_AUTH_CLIENT = new InjectionToken<StorefrontAuthClient>(
  'STOREFRONT_AUTH_CLIENT',
  {
    providedIn: 'root',
    factory: () => createStorefrontAuthClient(),
  },
);
