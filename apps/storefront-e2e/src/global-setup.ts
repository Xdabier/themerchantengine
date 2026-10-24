import { execSync } from 'child_process';
import * as path from 'path';
import Redis from 'ioredis';

/** The API this run talks to. Mirrors the webServer block in the config. */
const API_BASE = `http://localhost:${process.env['STOREFRONT_E2E_API_PORT'] ?? '53001'}/api`;
import { workspaceRoot } from '@nx/devkit';
import { assertTestTarget } from '../../../scripts/e2e-identity-guard';
import { describeHarnessStoreConfig } from './support/store-config-fixture';

/**
 * Playwright globalSetup. Plants the fixture catalogue into the test DB
 * before the suite runs so journey specs hit a populated catalog without
 * fixtures or `page.route()` mocks (constitution §3.8 forbids both).
 *
 * Also seeds `STOREFRONT_REVALIDATE_SECRET` so the S15 revalidate journey
 * spec can read the same secret the Nitro handler validates against.
 *
 * Set SKIP_SEED=1 in env to bypass when iterating locally on the e2e suite.
 */

/**
 * Drop every cached read before the suite starts.
 *
 * Seeding the database is not enough on its own: the API caches the sitemaps,
 * the product lists and the category reads in Redis, and Redis is a named
 * volume that outlives both the seed and `docker compose up`. So a suite that
 * reseeded correctly could still be served a sitemap built from a catalogue
 * that no longer exists, which is exactly what happened: the category SSR spec
 * discovers its slug from `/sitemap-categories.xml`, and the sitemap named
 * `gum-arabic`, a honey-catalogue slug with no row in the seeded database. The
 * storefront answered 200 with an empty shell for it, so the failure only
 * became visible once unknown slugs started answering a real 404.
 *
 * The backend e2e setup has always done this. This one had not.
 *
 * Best-effort: a suite pointed at a Redis that is not up should fail on its
 * own assertions rather than here, and a cold cache is the safe direction.
 */
async function flushRedis(): Promise<void> {
  const redis = new Redis({
    host: process.env['REDIS_TEST_HOST'] ?? 'localhost',
    port: Number(process.env['REDIS_TEST_PORT'] ?? 56380),
    lazyConnect: true,
    connectTimeout: 4000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await redis.flushdb();
    console.log('[storefront-e2e] flushed the test Redis');
  } catch {
    console.warn('[storefront-e2e] could not flush the test Redis — continuing with a warm cache');
  } finally {
    redis.disconnect();
  }
}
/**
 * Refuse to run against an API that is not this run's API.
 *
 * `reuseExistingServer` is on locally, so anything already listening on the
 * test API port is adopted as-is, with whatever database, Redis and public
 * base URL it was started with. When that happens the suite does not fail
 * cleanly: several specs discover their target URL from the API's own sitemap,
 * so a reused API serves absolute URLs on a host nothing in this run is
 * listening on, and the result is a wall of ERR_CONNECTION_REFUSED and status
 * mismatches pointing at everything except the cause. That is exactly what a
 * stale API on the port produced, and it cost an afternoon.
 *
 * The sitemap is the right thing to check because it is the one surface that
 * exposes all three at once: the host comes from the API's
 * STOREFRONT_PUBLIC_BASE_URL, the entries come from its database, and the
 * whole document comes from its Redis cache.
 */
async function assertApiBelongsToThisRun(expectedBase: string): Promise<void> {
  const url = `${API_BASE}/v1/sitemap-products.xml`;
  let xml: string;
  try {
    const res = await fetch(url);
    if (!res.ok) return; // the webServer block owns liveness; this is not that check
    xml = await res.text();
  } catch {
    return;
  }

  const firstLoc = /<loc>([^<]+)<\/loc>/.exec(xml)?.[1];
  if (!firstLoc) return; // an empty catalogue is a seeding question, not this one

  const host = new URL(firstLoc).origin;
  if (host === expectedBase) return;

  throw new Error(
    `[storefront-e2e] the API at ${API_BASE} is emitting absolute URLs on ${host}, but this ` +
      `run serves the storefront at ${expectedBase}. It is almost certainly a server left ` +
      `running on that port by another harness or an earlier session, which Playwright ` +
      `adopted because reuseExistingServer is on. Stop it and run again; specs that discover ` +
      `their target from the sitemap would otherwise fail against a host nothing is serving.`,
  );
}

export default async function globalSetup(): Promise<void> {
  // S15: ensure both the spec process and the spawned storefront webServer
  // see the same secret. The webServer config also reads this via
  // `process.env['STOREFRONT_REVALIDATE_SECRET']`, so a single default
  // here propagates to both halves.
  if (!process.env['STOREFRONT_REVALIDATE_SECRET']) {
    process.env['STOREFRONT_REVALIDATE_SECRET'] = 'storefront-e2e-revalidate-secret-32+bytes';
  }

  if (process.env.SKIP_SEED === '1') {
    console.log('[storefront-e2e] SKIP_SEED=1 — globalSetup skipped');
    return;
  }
  const script = path.resolve(workspaceRoot, 'scripts', 'seed-storefront-test.ts');
  console.log(`[storefront-e2e] seeding via ${script} (${describeHarnessStoreConfig()})`);
  execSync(`npx ts-node ${JSON.stringify(script)}`, {
    stdio: 'inherit',
    cwd: workspaceRoot,
  });

  // After the seed, so nothing that ran during it can repopulate a cache from
  // the pre-seed catalogue.
  await flushRedis();

  // Which database, before which host. `reuseExistingServer` is on locally, so
  // the API on the test port is whatever was already there, and this suite
  // mutates carts, orders, wishlists, reviews and customer accounts. The sister
  // check below then catches the narrower case of an API that IS on the test
  // database but is emitting URLs for a different run.
  await assertTestTarget(API_BASE, 'storefront-e2e');

  await assertApiBelongsToThisRun(
    process.env['BASE_URL'] ?? `http://localhost:${process.env['STOREFRONT_DEV_PORT'] ?? '53311'}`,
  );
}
