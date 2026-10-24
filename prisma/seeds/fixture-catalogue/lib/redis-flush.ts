import IORedis from 'ioredis';

/**
 * Cache prefixes the API writes for storefront-facing reads. After the seed
 * wipes + re-inserts the catalogue, every one of these can hold stale data
 * for up to its TTL. The loudest case is `storefront:sections:home`, which is
 * why the homepage shows fewer / wrong sections after a re-seed unless flushed.
 *
 * Mirrors the per-module `*_CACHE_PREFIX` constants under apps/api/src/modules/**.
 *
 * Each entry is scanned as `<entry>*`. Redis glob patterns treat `.` and `-`
 * as literal characters, so `geo:llms.txt:` matches the llms.txt keys and
 * nothing else: `geo:llms-full.txt:<locale>` needs its own entry.
 *
 * The `seo:` entries below are whole key names rather than prefixes. They hold
 * rendered XML / text that embeds locale-prefixed storefront URLs and carry 1
 * to 6 hour TTLs, so a stale entry keeps serving links for a locale the store
 * no longer has. The list stays enumerated on purpose: a blanket `seo:` scan
 * would also wipe `seo:indexnow:dedup:` and `seo:gsc:inspect:count:`, which are
 * dedup and daily-quota counters that must survive a reseed.
 */
const STOREFRONT_CACHE_PREFIXES = [
  'storefront:sections:',
  'products:detail:',
  'products:quality:',
  'geo:llms.txt:',
  'geo:llms-full.txt:',
  'seo:sitemap:',
  'seo:robots',
  'seo:merchant-feed',
  'shipping:zones:',
  'tax:zone:',
];

export interface FlushSummary {
  prefixesScanned: number;
  keysDeleted: number;
  durationMs: number;
}

/**
 * SCAN-and-DEL every storefront-related cache key. Runs against the same
 * Redis the API connects to (REDIS_HOST / REDIS_PORT / REDIS_PASSWORD env).
 *
 * Idempotent. Safe to call when the prefixes are empty (DEL of zero keys
 * is a no-op). The seed bypasses the admin-write endpoint that normally
 * triggers cache invalidation, so without this step the storefront keeps
 * serving the pre-seed cached payload until the per-key TTL elapses.
 */
export async function flushStorefrontCaches(log: (msg: string) => void): Promise<FlushSummary> {
  const t0 = Date.now();
  const summary: FlushSummary = {
    prefixesScanned: STOREFRONT_CACHE_PREFIXES.length,
    keysDeleted: 0,
    durationMs: 0,
  };

  const host = process.env['REDIS_HOST'] ?? 'localhost';
  const port = Number(process.env['REDIS_PORT'] ?? '6379');
  const password = process.env['REDIS_PASSWORD'] || undefined;
  const db = Number(process.env['REDIS_DB'] ?? '0');

  const redis = new IORedis({
    host,
    port,
    password,
    db,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    reconnectOnError: () => false,
  });

  try {
    await redis.connect();
  } catch (err) {
    log(
      `redis connect failed (${host}:${port}/${db}) — skipping cache flush: ${(err as Error).message}`,
    );
    redis.disconnect();
    summary.durationMs = Date.now() - t0;
    return summary;
  }

  for (const prefix of STOREFRONT_CACHE_PREFIXES) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
        summary.keysDeleted += keys.length;
      }
    } while (cursor !== '0');
  }

  await redis.quit();
  summary.durationMs = Date.now() - t0;
  log(
    `redis cache flushed: ${summary.keysDeleted} keys across ${summary.prefixesScanned} prefixes (${summary.durationMs}ms)`,
  );
  return summary;
}
