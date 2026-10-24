/**
 * Jest module stub for `better-auth/client` and `better-auth/client/plugins`.
 *
 * The Better Auth browser client is ESM-only and pulls in an ESM-only
 * dependency tree (`@better-fetch/fetch`, `nanostores`, …) that Jest's
 * CommonJS runtime cannot load. The admin's unit tests never use the real
 * client — every spec injects a fake through the `ADMIN_AUTH_CLIENT` token —
 * so this stub only has to keep the import graph resolvable. The real client
 * is exercised end-to-end by the admin Playwright suite against the live API.
 *
 * Wired via `moduleNameMapper` in `apps/admin/jest.config.ts`.
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
