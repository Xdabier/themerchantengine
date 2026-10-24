import Redis from 'ioredis';
// Relative on purpose: Nitro bundles the server without the workspace
// tsconfig aliases, and this module has no alias in `nitro.alias`.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { isProduction } from '../../../../../libs/shared/common/src/env/runtime-environment';

/**
 * Idempotency dedup store for the `/api/_internal/revalidate` webhook
 * receiver. Per constitution §3.6 + S21.7 admin-security-reviewer H-1
 * fix: the storefront SSR process MUST NOT use a per-instance in-memory
 * Map for inbound webhook dedup, because horizontal scale-out lets a
 * captured (secret, eventId) pair replay against any other replica
 * within the 12 h TTL window. Redis SETNX gives atomic cluster-wide
 * dedup across all storefront pods.
 *
 * The interface is small + pluggable so unit tests can inject the
 * `InMemoryDedupStore` impl below without standing up a real Redis.
 *
 * Production wiring: `getDefaultDedupStore()` lazy-initialises a single
 * Redis client per process the first time the receiver handles a
 * request. The client uses `lazyConnect:true` so module-eval does not
 * dial Redis (matters for SSR cold start + unit-test imports).
 */

export interface DedupStore {
  /**
   * Returns true if `key` was already recorded within the TTL window.
   * Atomic against the matching `recordEvent()` call so two concurrent
   * webhook deliveries with the same eventId never both succeed.
   *
   * Implementations MUST treat a transport error as "not duplicate" and
   * fall through to the recorder so the caller defaults to invalidation
   * (constitution §3.6 prefers re-invalidation to dropped events).
   */
  isDuplicate(key: string): Promise<boolean>;

  /**
   * Record `key` with `ttlMs` milliseconds expiry. Idempotent — calling
   * twice with the same key resets the TTL window. Implementations
   * SHOULD log transport errors but never throw, for the same reason
   * as above.
   */
  recordEvent(key: string, ttlMs: number): Promise<void>;
}

const REDIS_KEY_PREFIX = 'storefront:revalidate:dedup:';

class RedisDedupStore implements DedupStore {
  constructor(private readonly client: Redis) {}

  async isDuplicate(key: string): Promise<boolean> {
    try {
      const value = await this.client.get(REDIS_KEY_PREFIX + key);
      return value !== null;
    } catch (err) {
      // Fail-open per the interface contract: a Redis transport error
      // must not block invalidation. Log and treat as "not duplicate".
      // eslint-disable-next-line no-console
      console.error(
        '[revalidate-dedup]',
        JSON.stringify({
          op: 'isDuplicate',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
      return false;
    }
  }

  async recordEvent(key: string, ttlMs: number): Promise<void> {
    try {
      // SET key value PX ttl NX — atomic insert-only. Returns 'OK' if
      // the key did not exist (= recorded), null if it did. We do not
      // care about the return value here because `isDuplicate()` runs
      // first; the NX flag is belt-and-braces against a race between
      // two concurrent receivers handling the same eventId.
      await this.client.set(REDIS_KEY_PREFIX + key, '1', 'PX', ttlMs, 'NX');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        '[revalidate-dedup]',
        JSON.stringify({
          op: 'recordEvent',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
    }
  }
}

/**
 * In-memory dedup store. Used by unit tests + as the fallback when
 * `REDIS_HOST` is unset in development. Production MUST set
 * `REDIS_HOST` so the Redis-backed store is selected; the boot guard
 * in `getDefaultDedupStore()` enforces this when `NODE_ENV=production`.
 */
export class InMemoryDedupStore implements DedupStore {
  private readonly store = new Map<string, number>();

  async isDuplicate(key: string): Promise<boolean> {
    const expiry = this.store.get(key);
    return expiry !== undefined && expiry > Date.now();
  }

  async recordEvent(key: string, ttlMs: number): Promise<void> {
    this.store.set(key, Date.now() + ttlMs);
    // Opportunistic sweep on every insert — small map, O(n) is cheap.
    if (this.store.size > 1024) {
      const now = Date.now();
      for (const [k, exp] of this.store.entries()) {
        if (exp <= now) this.store.delete(k);
      }
    }
  }

  /** Test-only: clear all entries. */
  reset(): void {
    this.store.clear();
  }
}

let defaultStore: DedupStore | null = null;

/**
 * Resolve the process-wide dedup store. Lazy-initialised so module
 * import does not dial Redis (matters for SSR cold start + tests).
 *
 * Resolution order:
 *   1. `REDIS_HOST` set -> RedisDedupStore (production + dev).
 *   2. `NODE_ENV=production` and no `REDIS_HOST` -> throw at first use.
 *      Production MUST configure Redis per the §3.6 H-1 fix.
 *   3. Otherwise -> InMemoryDedupStore (dev fallback + tests).
 */
export function getDefaultDedupStore(): DedupStore {
  if (defaultStore) return defaultStore;

  const host = process.env['REDIS_HOST'];
  if (host) {
    const client = new Redis({
      host,
      port: Number(process.env['REDIS_PORT'] ?? 6379),
      password: process.env['REDIS_PASSWORD'] || undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    defaultStore = new RedisDedupStore(client);
    return defaultStore;
  }

  if (isProduction()) {
    throw new Error(
      'REDIS_HOST is required in production for revalidate webhook dedup (constitution §3.6, S21.7 H-1 fix). Set REDIS_HOST + REDIS_PORT (+ REDIS_PASSWORD) in apps/storefront/.env.production.',
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[revalidate-dedup] REDIS_HOST unset — falling back to in-memory dedup. Acceptable for local dev only; production deploys MUST set REDIS_HOST.',
  );
  defaultStore = new InMemoryDedupStore();
  return defaultStore;
}

/**
 * Test-only: replace the process-wide default store. Required by unit
 * tests that need a clean InMemoryDedupStore between cases without
 * tearing down + re-creating the Redis client.
 */
export function __setDefaultDedupStoreForTests(store: DedupStore | null): void {
  defaultStore = store;
}
