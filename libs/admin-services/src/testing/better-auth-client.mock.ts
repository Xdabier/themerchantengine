/**
 * Jest module stub for `better-auth/client` and `better-auth/client/plugins`.
 *
 * The Better Auth browser client is ESM-only and pulls in an ESM-only
 * dependency tree (`@better-fetch/fetch`, `nanostores`, …) that Jest's
 * CommonJS runtime cannot load. The `admin-services` unit tests never use the
 * real client — `auth.service.spec.ts` injects a fake through the
 * `ADMIN_AUTH_CLIENT` token — so this stub only has to keep the import graph
 * resolvable. The real client is exercised by the admin Playwright suite
 * against the live API.
 *
 * Wired via `moduleNameMapper` in `libs/admin-services/jest.config.cts`.
 */

export function createAuthClient(): Record<string, unknown> {
  return {};
}

export function twoFactorClient(): { id: string } {
  return { id: 'two-factor' };
}

export function magicLinkClient(): { id: string } {
  return { id: 'magic-link' };
}
