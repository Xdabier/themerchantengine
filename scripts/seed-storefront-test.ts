/**
 * Test-DB seed wrapper. Wired as Playwright globalSetup for the storefront e2e
 * suite. Runs the existing baseline seed (`prisma/seed.ts`) — which itself
 * invokes `seedFixtureCatalogue` post-baseline — against the test DB and a per-run
 * uploads directory so the dev tree is never polluted.
 *
 * Set `SKIP_SEED=1` to bypass when iterating on the e2e suite without
 * touching the catalog.
 *
 * Finishes by flushing the test Redis. The e2e API caches storefront sections
 * and the GEO / SEO surfaces for hours, so a key written before the reseed
 * outlives it and makes a spec fail for a reason that is not a code bug.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
// Relative on purpose: plain ts-node runs this and honours no tsconfig paths.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  DEFAULT_STORE_CONFIG_FIXTURE,
  STORE_CONFIG_FIXTURE_ENV,
} from '../libs/shared/common/src/store-config-fixtures';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { flushStorefrontCaches } from '../prisma/seeds/fixture-catalogue/lib/redis-flush';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ??
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:55433/merchants_engine_test';

const TEST_UPLOADS_ROOT = process.env.SEED_UPLOADS_ROOT ?? 'uploads-test';
// The e2e API serves TEST_UPLOADS_ROOT, so image URLs must point at it, not at
// the dev API the .env default names.
const TEST_UPLOADS_BASE_URL = `http://localhost:${process.env.STOREFRONT_E2E_API_PORT ?? '53001'}/uploads`;

// The dedicated test Redis (docker service on 56380 per CLAUDE.md), which is
// what the e2e API is spawned against. Read from the REDIS_TEST_* pair rather
// than REDIS_HOST / REDIS_PORT: dotenv above already loaded the dev instance
// on 56379 into those, and flushing dev caches from an e2e run is never right.
const TEST_REDIS_HOST = process.env.REDIS_TEST_HOST ?? 'localhost';
const TEST_REDIS_PORT = process.env.REDIS_TEST_PORT ?? '56380';

/**
 * Extract host, port, dbname from a postgres:// URL for passing to psql -h/-p/-d.
 * Returns null if the URL cannot be parsed (falls back to docker exec approach).
 */
function parsePgUrl(
  url: string,
): { host: string; port: string; user: string; password: string; dbname: string } | null {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || '5432',
      user: u.username,
      password: u.password,
      dbname: u.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function main(): Promise<void> {
  if (process.env.SKIP_SEED === '1') {
    console.log('[seed-storefront-test] SKIP_SEED=1 — skipping');
    return;
  }

  // Three harnesses share this database and the store config groups survive a
  // reseed, so a run that named no fixture inherited whichever harness went
  // last. Naming one is what makes the config and the catalogue agree: the seed
  // writes the fixture's rows, and the catalogue prices itself from them
  // (plan E2.6). The shared default is the config the visual baselines are
  // recorded against, and the e2e support helper reads the same constant.
  const fixture = process.env[STORE_CONFIG_FIXTURE_ENV] ?? DEFAULT_STORE_CONFIG_FIXTURE;

  const env = {
    ...process.env,
    DATABASE_URL: TEST_DB_URL,
    SEED_UPLOADS_ROOT: TEST_UPLOADS_ROOT,
    UPLOADS_BASE_URL: TEST_UPLOADS_BASE_URL,
    [STORE_CONFIG_FIXTURE_ENV]: fixture,
    // The fixture catalogue is opt-in, so a fresh database is not born carrying
    // products, promotions and home sections nobody asked for. This suite is the
    // one harness that genuinely needs it: its specs address fx- products and
    // categories directly, so it opts in here.
    FIXTURE_CATALOGUE_SEED: '1',
  };

  console.log(`[seed-storefront-test] target DB: ${TEST_DB_URL}`);
  console.log(`[seed-storefront-test] uploads root: ${TEST_UPLOADS_ROOT}`);
  console.log(`[seed-storefront-test] store config fixture: ${fixture}`);

  // 1. Sync schema (test DB may have migrated; use db push for speed).
  //    --accept-data-loss is required because prisma/search_fts_setup.sql adds
  //    the `searchVector` column outside Prisma's schema management, so Prisma
  //    sees it as drift and refuses to push without this flag. We re-apply the
  //    FTS setup immediately after the push (step 2) so the column is restored.
  //
  //    This deliberately does NOT `--force-reset`. Prisma refuses that flag
  //    inside an agent session without per-run human consent, so putting it
  //    here would make the e2e harness unrunnable by the phase pipeline. The
  //    staleness it would have solved is handled at the source instead:
  //    `prisma/seed.ts` refreshes the locale-bearing fields of the rows it
  //    owns rather than upserting them create-on-miss.
  console.log('[seed-storefront-test] prisma db push…');
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', env });

  // 2. Re-apply FTS setup (adds searchVector + trigger, idempotent via
  //    ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
  console.log('[seed-storefront-test] applying FTS setup…');
  const ftsSql = path.resolve(__dirname, '..', 'prisma', 'search_fts_setup.sql');
  if (!fs.existsSync(ftsSql)) {
    console.warn(`[seed-storefront-test] FTS SQL not found at ${ftsSql} — skipping`);
  } else {
    const pg = parsePgUrl(TEST_DB_URL);
    if (!pg) {
      throw new Error(`Cannot parse test DB URL: ${TEST_DB_URL}`);
    }
    execSync(
      `docker exec -i merchants-engine-postgres-test psql -U ${pg.user} -d ${pg.dbname} -f -`,
      {
        input: fs.readFileSync(ftsSql),
        stdio: ['pipe', 'inherit', 'inherit'],
      },
    );
  }

  // 3. Run the baseline seed — which now also runs seedFixtureCatalogue() at the end.
  // `--project apps/api/tsconfig.app.json` is kept so tsconfig-paths/register
  // can resolve the `@common/*` aliases (e.g. @common/asset-variants used by
  // assets.constants.ts) without a compiled dist tree. That tsconfig sets
  // `module: preserve`, which ts-node maps to the Node ESM loader — and the
  // ESM loader rejects a `.ts` entrypoint with ERR_UNKNOWN_FILE_EXTENSION. So
  // `module` is overridden back to CommonJS for the ts-node run via
  // TS_NODE_COMPILER_OPTIONS; the `paths` are still read from the project.
  console.log('[seed-storefront-test] running baseline + fixture catalogue seed…');
  execSync(
    'npx ts-node --project apps/api/tsconfig.app.json -r tsconfig-paths/register prisma/seed.ts',
    { stdio: 'inherit', env: { ...env, TS_NODE_COMPILER_OPTIONS: '{"module":"CommonJS"}' } },
  );

  // 4. Flush the test Redis so the freshly seeded rows are what the specs read.
  //    Non-fatal: a Redis that is down must not fail the seed, but a stale key
  //    is the likeliest cause of a spec failing right after a reseed, so it is
  //    warned about loudly.
  console.log(`[seed-storefront-test] flushing test redis ${TEST_REDIS_HOST}:${TEST_REDIS_PORT}…`);
  const priorRedisHost = process.env.REDIS_HOST;
  const priorRedisPort = process.env.REDIS_PORT;
  process.env.REDIS_HOST = TEST_REDIS_HOST;
  process.env.REDIS_PORT = TEST_REDIS_PORT;
  try {
    await flushStorefrontCaches((msg) => console.log(`[seed-storefront-test] ${msg}`));
  } catch (err) {
    console.warn(
      `[seed-storefront-test] redis flush failed on ${TEST_REDIS_HOST}:${TEST_REDIS_PORT}, ` +
        `specs may read stale cached payloads: ${(err as Error).message}`,
    );
  } finally {
    restoreEnv('REDIS_HOST', priorRedisHost);
    restoreEnv('REDIS_PORT', priorRedisPort);
  }

  console.log('[seed-storefront-test] done.');
}

main().catch((err) => {
  console.error('[seed-storefront-test] failed:', err);
  process.exit(1);
});
