/**
 * Jest module stub for `better-auth/client` and `better-auth/client/plugins`.
 *
 * The Better Auth browser client is ESM-only and pulls in an ESM-only
 * dependency tree (`@better-fetch/fetch`, `nanostores`, ...) that Jest's
 * CommonJS runtime cannot load. `admin-ui` never touches the client itself,
 * but `asset-picker.component.ts` imports `AssetsService` from the
 * `@admin-services` barrel, and that barrel re-exports the auth client, so the
 * two asset-picker specs pull the whole ESM tree in transitively and fail to
 * parse. This stub only has to keep that import graph resolvable. The real
 * client is exercised by the admin Playwright suite against the live API.
 *
 * Wired via `moduleNameMapper` in `libs/admin-ui/jest.config.cts`, mirroring
 * `apps/admin/jest.config.ts` and `libs/admin-services/jest.config.cts`.
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
