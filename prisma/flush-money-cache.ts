/**
 * Flush the Redis keyspaces that cache money, a currency, or a tax rate.
 *
 * There was no flush anywhere in the repository before D4: not in `deploy`,
 * not in `scripts`, not in the deploy pipeline, not in `package.json`. That was
 * survivable while the store had one currency and a zero tax rate. It is not
 * survivable across a currency cutover, because `redis-data` is a named volume
 * that outlives `docker compose up -d`, so a stale entry serves the OLD money
 * for its full TTL after the seed has already written the new.
 *
 * The keyspaces are the shared `MONEY_CACHE_KEY_PATTERNS` list, which the API's
 * in-process listener on `store-config.updated` flushes too (plan E1.4.4), so a
 * seed and a settings write clear the same keys.
 *
 * ORDER MATTERS: run this AFTER the seed, never before. A flush that runs
 * first simply repopulates from the rows the seed is about to replace.
 *
 * Deliberately NOT `FLUSHALL`. The same Redis holds BullMQ queues and
 * idempotency keys; wiping those would drop in-flight jobs and let a replayed
 * request create a second order.
 */
import Redis from 'ioredis';

import { MONEY_CACHE_KEY_PATTERNS } from '../libs/shared/common/src/money/money-cache-keys';

const PATTERNS = MONEY_CACHE_KEY_PATTERNS;

export async function flushMoneyCache(): Promise<number> {
  // Same connection shape the app itself uses (`apps/api/src/auth/auth.ts`),
  // rather than a REDIS_URL this repository does not set anywhere: the env
  // carries REDIS_HOST and REDIS_PORT. A URL-only reader would have silently
  // no-opped in every environment, which is the failure mode a cache flush
  // can least afford — it reports success while flushing nothing.
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 56379),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
  });
  let removed = 0;
  try {
    await redis.connect();
    for (const pattern of PATTERNS) {
      // SCAN rather than KEYS: KEYS blocks the server for the whole sweep, and
      // this may run against production during a cutover.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 250);
        cursor = next;
        if (keys.length) removed += await redis.del(...keys);
      } while (cursor !== '0');
    }
    console.log(
      `  [flush-money-cache] removed ${removed} key(s) across ${PATTERNS.length} patterns`,
    );
  } catch (err) {
    // A cache flush must never fail a deploy: the entries expire on their own,
    // and a hard failure here would roll back a seed that already succeeded.
    console.warn(`  [flush-money-cache] skipped: ${(err as Error).message}`);
  } finally {
    redis.disconnect();
  }
  return removed;
}

if (require.main === module) {
  void flushMoneyCache().then(() => process.exit(0));
}
