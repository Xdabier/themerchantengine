import {
  NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
  storefrontRuntimeConfigSchema,
  type StorefrontRuntimeConfig,
} from '@storefront-types';

/**
 * The runtime store config for the code that runs before Angular does.
 *
 * The Nitro layer answers requests the Angular injector never sees: the root
 * locale redirect decides where `/` goes, and it has to know which locales the
 * store serves and which one is its default. Reading `GET /v1/store/config`
 * there is a cross-process call, so it is cached per process rather than made
 * per request.
 *
 * Three properties matter and each is deliberate:
 *
 * One in-flight request. A cold process handling a burst would otherwise open
 * one upstream call per request, all asking the same question.
 *
 * A short TTL. The config changes when an operator saves a settings screen,
 * which is rare, and a minute of staleness on a locale set is invisible; the
 * API caches the same payload for the same minute.
 *
 * Fail-closed to the committed neutral config, never a throw. This runs in the
 * request path of every page. An API that is slow, restarting or unreachable
 * must degrade to a storefront in its default shape, not to a 500 for every
 * visitor. The same neutral config is what the Angular service falls back to,
 * so the server and the client never disagree about what unconfigured means.
 */

const TTL_MS = 60_000;
const TIMEOUT_MS = 2_000;

/**
 * How long a failed read is remembered (plan E2.6, B7.4).
 *
 * A failure was never cached, on the reasoning that a fallback answer must not
 * pin the neutral config in front of an API that is about to come back. True,
 * but it left every request in this path paying a fresh two-second timeout for
 * as long as the API was unreachable: one in-flight call is shared, so requests
 * that arrive together wait once, but the next one after it settles starts the
 * clock again. Short enough that a recovering API is picked up within seconds,
 * long enough that a sustained outage costs one timeout rather than one per
 * request.
 */
export const FAILURE_TTL_MS = 5_000;

interface CacheEntry {
  value: StorefrontRuntimeConfig;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<StorefrontRuntimeConfig> | null = null;
/** Epoch millis until which a failed read is not retried. `0` means never failed. */
let failedUntil = 0;

/**
 * The same default every other reader of this variable uses
 * (`server/api-client.ts`, `server/proxy-seo.ts`). An empty base produced a
 * relative URL, which `fetch` rejects in Node, so a developer with the
 * variable unset silently got the neutral config on every root redirect.
 */
const DEFAULT_API_BASE = 'http://localhost:53000/api';

function endpoint(): string {
  const base = process.env['STOREFRONT_API_URL'] || DEFAULT_API_BASE;
  return `${base.replace(/\/+$/, '')}/v1/store/config`;
}

async function fetchConfig(fetchImpl: typeof fetch): Promise<StorefrontRuntimeConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(endpoint(), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return NEUTRAL_STOREFRONT_RUNTIME_CONFIG;
    const body = (await res.json()) as { data?: unknown };
    const parsed = storefrontRuntimeConfigSchema.safeParse(body?.data);
    return parsed.success ? parsed.data : NEUTRAL_STOREFRONT_RUNTIME_CONFIG;
  } catch {
    // Unreachable, slow, or malformed. All three degrade the same way.
    return NEUTRAL_STOREFRONT_RUNTIME_CONFIG;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The config for this request, from the process cache when it is warm.
 *
 * A successful read is cached for `TTL_MS`. A failed one is remembered only for
 * `FAILURE_TTL_MS`, which bounds how much a sustained outage costs without
 * pinning the neutral config in front of an API that is about to come back.
 */
export async function readStoreConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<StorefrontRuntimeConfig> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  if (failedUntil > now) return NEUTRAL_STOREFRONT_RUNTIME_CONFIG;
  inFlight ??= fetchConfig(fetchImpl)
    .then((value) => {
      if (value === NEUTRAL_STOREFRONT_RUNTIME_CONFIG) {
        failedUntil = Date.now() + FAILURE_TTL_MS;
      } else {
        cache = { value, expiresAt: Date.now() + TTL_MS };
        failedUntil = 0;
      }
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Drops the process cache. For specs, and for a revalidate hook to call. */
export function resetStoreConfigCache(): void {
  cache = null;
  inFlight = null;
  failedUntil = 0;
}
