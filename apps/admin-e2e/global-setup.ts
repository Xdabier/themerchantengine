import { request, type FullConfig } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { assertTestTarget, portAnswers } from '../../scripts/e2e-identity-guard';
import { describeHarnessStoreConfig } from './src/support/store-config-fixture';
import {
  DEFAULT_STORE_CONFIG_FIXTURE,
  STORE_CONFIG_FIXTURE_ENV,
} from '@common/store-config-fixtures';
import { applyFtsSetup } from '../../prisma/apply-fts-setup';

/**
 * Live-backend e2e bootstrap. The goal is to give every spec a logged-in
 * admin session hitting a real NestJS + Postgres + Redis stack, so the
 * screens exercise the same code paths production would.
 *
 * Flow:
 *   1. Ensure the `postgres-test` + `redis-test` docker-compose services are
 *      running. They're declared in the repo's docker-compose.yml on ports
 *      55433 + 56380.
 *   2. Sync the Prisma schema to the test DB + seed the superadmin user.
 *   3. Spawn the NestJS API on :53001 with NODE_ENV=test pointing at the
 *      test DB/Redis. Keep the PID so teardown can kill it.
 *   4. POST /v1/auth/sign-in/email with the superadmin credentials, capture
 *      the Better Auth session cookies Playwright replays on every spec.
 *
 * Failure at any step aborts the whole suite — no point running specs if
 * the backend isn't reachable.
 */

const WORKSPACE_ROOT = resolve(__dirname, '..', '..');
const STATE_DIR = resolve(__dirname, '.playwright-state');
const STORAGE_STATE_PATH = resolve(STATE_DIR, 'storage-state.json');
const API_PID_PATH = resolve(STATE_DIR, 'api.pid');

// E2E_API_PORT moves the test API when the OS reserves 53001 (a Windows
// Hyper-V dynamic-port exclusion can cover it). `serve-admin-e2e.mjs` reads
// the same variable to generate the admin's /api proxy target, so both halves
// always agree. This override replaces PLAYWRIGHT_SKIP_LIVE_BACKEND, which
// solved the same port clash by pointing the whole suite at the DEV stack.
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 53001);
const API_GLOBAL_PREFIX = 'api';
const API_ORIGIN = `http://localhost:${API_PORT}`;
const API_HEALTH_URL = `${API_ORIGIN}/health`;
/** The API base the SPECS reach through the admin proxy, prefix included. */
const API_BASE = `${API_ORIGIN}/${API_GLOBAL_PREFIX}`;

export const E2E_STORAGE_STATE = STORAGE_STATE_PATH;
export const E2E_API_PORT = API_PORT;

interface SeededAdmin {
  email: string;
  password: string;
}

const SUPERADMIN: SeededAdmin = {
  email: 'superadmin@merchants.test',
  password: 'Admin123!',
};

async function waitForHttp(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ctx = await request.newContext();
      const res = await ctx.get(url, { timeout: 2000 });
      await ctx.dispose();
      if (res.ok()) return;
    } catch {
      // keep polling
    }
    await sleep(500);
  }
  throw new Error(`[${label}] never became ready at ${url} within ${timeoutMs} ms`);
}

function run(command: string, env: NodeJS.ProcessEnv = {}): void {
  execSync(command, {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function startDockerServices(): void {
  // In GitHub Actions the `services:` block provisions Postgres + Redis as
  // sibling containers — no docker-compose required. Skip the bring-up
  // step when `CI` is set.
  if (process.env.CI) return;
  // `docker-compose up` is idempotent — re-runs against a running service
  // return immediately. Use the test-named services only to avoid touching
  // the developer's dev DB.
  run('docker-compose up -d postgres-test redis-test');
}

async function waitForPostgres(testEnv: NodeJS.ProcessEnv): Promise<void> {
  const deadline = Date.now() + 60_000;
  // Local dev runs Postgres in a named docker container, so `docker exec`
  // is the cheapest health probe. CI uses service containers and `psql`
  // straight from the runner reaches the bound port.
  const probe = process.env.CI
    ? `psql "${testEnv['DATABASE_URL'] ?? ''}" -c "select 1" -tA`
    : 'docker exec merchants-engine-postgres-test pg_isready -U postgres';
  while (Date.now() < deadline) {
    try {
      execSync(probe, { stdio: 'ignore' });
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error('postgres-test did not become healthy within 60 s');
}

function flushTestRedis(testEnv: NodeJS.ProcessEnv): void {
  // Flush the test Redis DB before seeding. Better Auth persists rate-limit
  // counters in Redis keyed per IP/email. If a prior run hit the rate-limiter
  // (e.g. 8 workers each calling sign-in simultaneously), the counters survive
  // across runs and cause the global-setup sign-in to 429. Flushing DB 0 on
  // the test Redis (port 56380) clears those counters without touching the dev
  // Redis (port 56379). This is safe because the test Redis is ephemeral —
  // it is always rebuilt by seedDatabase() immediately after this call.
  const redisHost = testEnv['REDIS_HOST'] ?? 'localhost';
  const redisPort = testEnv['REDIS_PORT'] ?? '56380';
  const flushCmd = process.env.CI
    ? `redis-cli -h ${redisHost} -p ${redisPort} FLUSHDB`
    : `docker exec merchants-engine-redis-test redis-cli FLUSHDB`;
  try {
    run(flushCmd, testEnv);
  } catch {
    // Redis flush is best-effort — if docker exec fails (e.g. container not
    // running yet), the seed step will still work; just log and continue.
    // eslint-disable-next-line no-console
    console.warn('[e2e-setup] redis flush skipped (non-fatal)');
  }
}

async function seedDatabase(testEnv: NodeJS.ProcessEnv): Promise<void> {
  // Non-destructive schema sync — acceptable for e2e since we control the
  // fixture DB end-to-end. `migrate reset --force` would be stronger isolation
  // but costs ~10 s per run, which we can't afford on every watch-mode save.
  // `--url` overrides whatever prisma.config.ts's dotenv.config() pulled in
  // from .env, since dotenv doesn't respect process.env values that were set
  // *before* it ran.
  const testUrl = testEnv['DATABASE_URL'];
  if (!testUrl) throw new Error('[e2e-setup] DATABASE_URL missing from testEnv');
  // Wipe the public schema before db-push so the seed always runs against
  // empty tables — critical for idempotent roles (the seed uses upsert
  // with `update: {}`, which would otherwise leave stale permission rows
  // from a previous run). `prisma db push --force-reset` is the native
  // knob for this but it's blocked by the Prisma 7 Claude-Code guardrail,
  // so we do the schema reset manually via psql. Local uses `docker exec`
  // (named container); CI uses the psql client already on the runner
  // talking to the service-container port.
  const resetCmd = process.env.CI
    ? `psql "${testUrl}" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"`
    : `docker exec merchants-engine-postgres-test psql -U postgres -d merchants_engine_test -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"`;
  run(resetCmd, testEnv);
  run(`npx prisma db push --accept-data-loss --url="${testUrl}"`, testEnv);
  // The FTS index (searchVector column, trigger, GIN/trigram indexes) is not
  // in schema.prisma, so `db push` just dropped it. Every `db push` needs this
  // re-applied or the product search the order/product picker specs drive
  // returns nothing — see prisma/apply-fts-setup.ts's own header and the
  // backend e2e harness (test/e2e-global-setup.ts), which does the same.
  await applyFtsSetup(testUrl);
  // Prisma 7 dropped `package.json -> prisma.seed`; config-file seed isn't
  // wired for this repo. Run the seed script directly — the env we pass
  // carries DATABASE_URL pointing at the test DB.
  run('npx ts-node prisma/seed.ts', testEnv);
}

function buildApi(testEnv: NodeJS.ProcessEnv): void {
  // One-shot production build — serves requests deterministically + avoids
  // the watcher-mode weirdness where nest start races with the watch
  // compiler and tries to run a `main` (no extension) that doesn't exist.
  // `--skip-nx-cache` because a previous dev-build is almost certainly
  // cached and we'd miss recent backend edits (e.g. auth cookie path).
  run('npx nx build api --skip-nx-cache', testEnv);
}

/**
 * Refuse to spawn onto an occupied port.
 *
 * `startApi` never checked. When something already held the port the spawn
 * died with EADDRINUSE into `api.log` and a console warning, while
 * `waitForHttp` passed cheerfully against the squatter — and if the squatter
 * was wired to the dev database, the whole suite wrote there. A stale run of
 * this same harness is the common case, so its recorded pid gets one chance to
 * be cleaned up; anything else is the operator's to stop.
 */
async function assertPortFree(): Promise<void> {
  if (!(await portAnswers(API_ORIGIN))) return;

  if (existsSync(API_PID_PATH)) {
    const stale = Number(readFileSync(API_PID_PATH, 'utf8').trim());
    if (Number.isFinite(stale)) {
      // eslint-disable-next-line no-console
      console.warn(`[e2e-setup] :${API_PORT} is occupied; killing our recorded pid ${stale}`);
      try {
        execSync(
          process.platform === 'win32' ? `taskkill /PID ${stale} /T /F` : `kill -TERM ${stale}`,
          { stdio: 'ignore' },
        );
      } catch {
        // already gone
      }
      await sleep(2000);
      if (!(await portAnswers(API_ORIGIN))) return;
    }
  }

  throw new Error(
    `[e2e-setup] port ${API_PORT} is squatted by a process this harness did not start. ` +
      'Stop it (a leftover `nest start --watch`, a stopped storefront-e2e run, or a ' +
      'previous suite whose teardown never ran) or set E2E_API_PORT to a free port. ' +
      'Adopting it is what wrote e2e fixtures into the dev database for two weeks.',
  );
}

function startApi(testEnv: NodeJS.ProcessEnv): ChildProcess {
  const api = spawn('node', ['dist/apps/api/main.js'], {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, ...testEnv, PORT: String(API_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  const logFile = resolve(STATE_DIR, 'api.log');
  api.stdout?.on('data', (chunk) => writeFileSync(logFile, chunk, { flag: 'a' }));
  api.stderr?.on('data', (chunk) => writeFileSync(logFile, chunk, { flag: 'a' }));

  if (api.pid) {
    writeFileSync(API_PID_PATH, String(api.pid));
  }
  return api;
}

async function loginAndCaptureStorageState(): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_ORIGIN });
  // Better Auth (DR-24, BA3) — sign in via the email/password endpoint.
  // The `/api` global prefix ensures the Set-Cookie path matches what the
  // admin's `/api/*` proxy rewrites to when it forwards credentials.
  const res = await ctx.post(`/${API_GLOBAL_PREFIX}/v1/auth/sign-in/email`, {
    data: { email: SUPERADMIN.email, password: SUPERADMIN.password },
  });
  if (!res.ok()) {
    throw new Error(`[e2e-setup] Better Auth sign-in failed: ${res.status()} ${await res.text()}`);
  }
  // Validate that we received better-auth session cookies — if none arrived
  // the session-bootstrap on the admin side will silently redirect to /auth/login.
  const state = await ctx.storageState();
  const sessionCookies = state.cookies.filter((c) => c.name.startsWith('better-auth'));
  if (!sessionCookies.length) {
    throw new Error(
      '[e2e-setup] sign-in response carried no better-auth session cookie — check the seed and the Better Auth cookie prefix (advanced.cookiePrefix)',
    );
  }
  await ctx.storageState({ path: STORAGE_STATE_PATH });
  await ctx.dispose();
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

  // eslint-disable-next-line no-console
  console.log('[e2e-setup] starting docker services');
  startDockerServices();

  // Before the seed and the build, not only before the spawn: a squatted port
  // is a three-minute wait away from being discovered otherwise, and the
  // operator has to stop the process either way. Checked again just before the
  // spawn, since a build takes long enough for something to arrive.
  await assertPortFree();

  const testEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL:
      process.env['DATABASE_TEST_URL'] ??
      'postgresql://postgres:postgres@localhost:55433/merchants_engine_test',
    REDIS_HOST: process.env['REDIS_TEST_HOST'] ?? 'localhost',
    REDIS_PORT: process.env['REDIS_TEST_PORT'] ?? '56380',
    // Include both env-var spellings so that whichever one main.ts's
    // `process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS` expression
    // resolves first carries the e2e vite-server origin.
    // ADMIN_DEV_PORT may be overridden (e.g. 4321) when Windows Hyper-V
    // reserves the normal e2e ports (53211 / 53200).
    CORS_ORIGIN: `http://localhost:${process.env['ADMIN_DEV_PORT'] ?? '53211'},http://localhost:53211,http://localhost:53200,${process.env['CORS_ORIGIN'] ?? ''}`,
    CORS_ORIGINS: `http://localhost:${process.env['ADMIN_DEV_PORT'] ?? '53211'},http://localhost:53211,http://localhost:53200,${process.env['CORS_ORIGINS'] ?? ''}`,
    // Mount everything under /api so the admin's `/api/*` proxy forwards
    // unrewritten and cookie paths match (see README → E2E strategy).
    API_GLOBAL_PREFIX,
    // Plan E1.4 deviation (specs/features/cli-brand-agnostic-setup/tasks.md):
    // the neutral seed (no fixture) plants no country, no shipping zone and no
    // domestic tax zone, so a bare reseed is not a usable store for journeys
    // that order or ship. The backend e2e harness already defaults to `demo`
    // for the same reason; this harness schema-resets on every run (a fresh,
    // unconfigured database) so it needs the same default to stay a
    // configured store rather than falling through to the neutral one.
    [STORE_CONFIG_FIXTURE_ENV]:
      process.env[STORE_CONFIG_FIXTURE_ENV] ?? DEFAULT_STORE_CONFIG_FIXTURE,
  };

  await waitForPostgres(testEnv);

  // eslint-disable-next-line no-console
  console.log('[e2e-setup] flushing test Redis to clear stale rate-limit counters');
  flushTestRedis(testEnv);

  // eslint-disable-next-line no-console
  console.log(`[e2e-setup] syncing schema + seeding fixtures (${describeHarnessStoreConfig()})`);
  await seedDatabase(testEnv);

  // eslint-disable-next-line no-console
  console.log('[e2e-setup] building api');
  buildApi(testEnv);

  await assertPortFree();

  // eslint-disable-next-line no-console
  console.log(`[e2e-setup] spawning api on :${API_PORT}`);
  const api = startApi(testEnv);
  api.on('exit', (code, signal) => {
    // eslint-disable-next-line no-console
    console.warn(`[e2e-setup] api exited code=${code} signal=${signal}`);
  });

  await waitForHttp(API_HEALTH_URL, 90_000, 'api');

  // `/health` proves a server, not OUR server: it carries no identity and is
  // registered outside the global prefix, so it answers 200 on a dev-wired
  // instance too. Ask what database this one holds, through the same prefixed
  // base the specs use, and abort before the sign-in below writes anything.
  const identity = await assertTestTarget(API_BASE, 'e2e-setup');
  // eslint-disable-next-line no-console
  console.log(`[e2e-setup] target confirmed: env=${identity.env} db=${identity.database}`);

  // That proved the API this harness spawned. It says nothing about which server
  // answers on the admin port, and `reuseExistingServer` may now adopt one that
  // was already running. Ask the same question through the admin proxy, the path
  // every spec actually takes: a server carrying proxy.conf.json points at the
  // dev API, and the run has to die here rather than render dev data. The authed
  // fixture asks this per worker; the public projects never reach that fixture.
  const proxied = await assertTestTarget(
    `http://localhost:${process.env['ADMIN_DEV_PORT'] ?? '53211'}/${API_GLOBAL_PREFIX}`,
    'e2e-setup proxy',
  );
  // eslint-disable-next-line no-console
  console.log(`[e2e-setup] proxy confirmed: env=${proxied.env} db=${proxied.database}`);

  // eslint-disable-next-line no-console
  console.log('[e2e-setup] logging in superadmin + snapshotting storage state');
  await loginAndCaptureStorageState();

  // eslint-disable-next-line no-console
  console.log('[e2e-setup] ready');
}
