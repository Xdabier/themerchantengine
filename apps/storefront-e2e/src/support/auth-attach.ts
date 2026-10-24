import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Better Auth e2e session helper for storefront Playwright specs (DR-24, BA4).
 *
 * The storefront authenticates through Better Auth: a session is one
 * `HttpOnly` cookie the API sets on `sign-in/email` / `sign-up/email`. There is
 * no access token, no `refreshToken`, and no `refreshTokenAlive` companion
 * cookie — all retired with the custom JWT stack.
 *
 * This module is the single source of truth for the storefront-e2e auth
 * setup, replacing the per-spec `loginViaApi` / `registerViaApi` / Bearer-header
 * blocks the JWT stack required:
 *
 *   - `signInViaApi`        — POST sign-in/email, return the session cookies.
 *   - `signUpViaApi`        — POST sign-up/email, return the session cookies.
 *   - `attachAuthToBrowser` — seed those cookies into a browser context so the
 *     SSR shell boots authenticated.
 *   - `authCookieHeader`    — build a `Cookie:` header for raw API calls made
 *     as a specific customer (no shared cookie jar — multi-user-spec safe).
 *
 * The e2e API (`apps/storefront-e2e/playwright.config.ts` webServer) runs with
 * `AUTH_SKIP_EMAIL_VERIFICATION=1`, so a freshly signed-up customer is
 * immediately authenticated — no inbox round-trip.
 */

/** Base URL of the API the storefront e2e suite drives — includes the `/api` global prefix. */
export const STOREFRONT_API_BASE =
  process.env['STOREFRONT_API_URL'] ?? 'http://localhost:53001/api';

/** A Playwright cookie ready for `BrowserContext.addCookies`. */
interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/** A captured Better Auth session — the cookies plus the customer id. */
export interface AuthSession {
  /** Better Auth session cookies, ready for `attachAuthToBrowser`. */
  cookies: PlaywrightCookie[];
  /** The authenticated customer's user id (empty string when the body omits it). */
  userId: string;
}

/** Customer details for `signUpViaApi`. */
export interface SignUpInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

function parseBetterAuthCookies(setCookieHeaders: string[]): PlaywrightCookie[] {
  const cookies: PlaywrightCookie[] = [];
  for (const header of setCookieHeaders) {
    const segments = header.split(';').map((s) => s.trim());
    const pair = segments[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    // Only the Better Auth cookies — `better-auth.session_token` and the
    // `better-auth.session_data` cookie-cache (auth.ts advanced.cookiePrefix).
    if (!name.startsWith('better-auth')) continue;
    const value = pair.slice(eq + 1);
    const attrs = segments.slice(1).map((s) => s.toLowerCase());
    cookies.push({
      name,
      value,
      // Re-homed to bare `localhost` / `/` so the cookie rides every same-host
      // request the browser makes to the storefront (53311) and, via the Vite
      // proxy, on to the API (53001).
      domain: 'localhost',
      path: '/',
      httpOnly: attrs.includes('httponly'),
      // The test API serves plain HTTP (`useSecureCookies` is production-only),
      // so seed `secure: false` — Playwright would otherwise drop the cookie on
      // the HTTP test transport.
      secure: false,
      sameSite: 'Lax',
    });
  }
  return cookies;
}

function setCookieHeadersOf(headers: Array<{ name: string; value: string }>): string[] {
  return headers.filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);
}

async function postAuth(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
): Promise<AuthSession> {
  const res = await request.post(`${STOREFRONT_API_BASE}/v1/auth/${path}`, { data });
  if (!res.ok()) {
    throw new Error(
      `[auth-attach] POST /v1/auth/${path} failed: ${res.status()} ${await res.text()}`,
    );
  }
  const cookies = parseBetterAuthCookies(setCookieHeadersOf(res.headersArray()));
  if (cookies.length === 0) {
    throw new Error(
      `[auth-attach] POST /v1/auth/${path} succeeded but set no better-auth session cookie — ` +
        'check auth.ts advanced.cookiePrefix and AUTH_SKIP_EMAIL_VERIFICATION on the e2e API.',
    );
  }
  const body = (await res.json().catch(() => ({}))) as { user?: { id?: string } };
  return { cookies, userId: body.user?.id ?? '' };
}

/** Sign an existing customer in via the Better Auth email/password endpoint. */
export function signInViaApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<AuthSession> {
  return postAuth(request, 'sign-in/email', { email, password });
}

/**
 * Register a new customer via the Better Auth email/password endpoint. The e2e
 * API runs with `AUTH_SKIP_EMAIL_VERIFICATION=1`, so the response already
 * carries an authenticated session — no verification step.
 */
export function signUpViaApi(request: APIRequestContext, input: SignUpInput): Promise<AuthSession> {
  return postAuth(request, 'sign-up/email', {
    email: input.email,
    password: input.password,
    name: `${input.firstName} ${input.lastName}`.trim(),
    firstName: input.firstName,
    lastName: input.lastName,
  });
}

/**
 * Seed a captured Better Auth session into the browser context so the SSR
 * shell boots authenticated and `layout-shell.boot()`'s single `getSession()`
 * resolves the customer (constitution §3.11.6).
 */
export async function attachAuthToBrowser(page: Page, session: AuthSession): Promise<void> {
  await page.context().addCookies(session.cookies);
}

/**
 * Build a `Cookie:` request header for raw API calls made as a specific
 * customer. Pass it explicitly per call rather than relying on a shared
 * `APIRequestContext` cookie jar — that keeps multi-customer specs (e.g. the
 * account OwnerGuard journey) from cross-contaminating sessions.
 */
export function authCookieHeader(session: AuthSession): string {
  return session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
