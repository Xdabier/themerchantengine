/**
 * Shared helpers consumed by `pages/**\/*.server.ts` companions.
 *
 * Authored at SH7 to close the SH4 + SH5 reviewer-deferred refactor item:
 * the `readErrorStatus` shape was duplicated across four `.server.ts` files
 * (about, catalog/[slug], catalog/product/[slug], policies/[slug]). Hoisting
 * it here keeps the .server.ts companions thin and removes the four-place
 * drift surface.
 */

/**
 * Reads an HTTP error status off an unknown thrown value. The storefront's
 * `createServerApiClient` rejects non-2xx responses with an `Error`-like
 * object that carries either `status` or `statusCode` depending on the
 * underlying h3 / fetch path. This helper normalises the lookup.
 *
 * Returns `null` when the thrown value carries neither field — caller
 * decides whether that means "swallow + return empty" (soft-fail) or
 * "rethrow as 500" (hard-fail) per `agent_docs/storefront/ssr-data-loading.md`
 * `## Error handling`.
 */
export function readErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { status?: number; statusCode?: number };
  return e.status ?? e.statusCode ?? null;
}
