import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { sweepTestFixtures } from '../../scripts/e2e-fixture-sweep';

const STATE_DIR = resolve(__dirname, '.playwright-state');
const API_PID_PATH = resolve(STATE_DIR, 'api.pid');
const STORAGE_STATE_PATH = resolve(STATE_DIR, 'storage-state.json');
const API_PORT = 53001;

/**
 * Cross-platform process kill. Windows + Node-side process trees don't
 * propagate SIGTERM cleanly, so on that platform we drop to `taskkill`.
 */
function killPid(pid: number): void {
  if (process.platform === 'win32') {
    try {
      require('node:child_process').execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // already dead — fine
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already dead — fine
    }
  }
}

/**
 * Backstop on the shared-session contract.
 *
 * `_auth-fixture.ts` checks the session is alive before each worker's first
 * test, and `fixture-contract.spec.ts` checks no spec revokes it. This is the
 * third net: it catches a revoker that arrives through a path neither of those
 * models, at the cost of one request per run. It presents the session token
 * alone, without the signed `session_data` cookie, so Better Auth resolves it
 * against the database rather than from its five-minute cache.
 *
 * It reports rather than throws when the API is already gone: teardown runs
 * after the suite, and turning a clean run red because the server exited first
 * would be worse than the problem.
 */
async function reportSharedSessionState(): Promise<void> {
  if (!existsSync(STORAGE_STATE_PATH)) return;
  let token: { name: string; value: string } | undefined;
  try {
    const state = JSON.parse(readFileSync(STORAGE_STATE_PATH, 'utf8')) as {
      cookies: { name: string; value: string }[];
    };
    token = state.cookies.find((c) => c.name === 'better-auth.session_token');
  } catch {
    return;
  }
  if (!token) return;

  try {
    const res = await fetch(`http://localhost:${API_PORT}/api/v1/auth/get-session`, {
      headers: { Cookie: `${token.name}=${token.value}` },
    });
    const payload = res.ok ? ((await res.json()) as { user?: { id?: string } } | null) : null;
    if (!payload?.user?.id) {
      // eslint-disable-next-line no-console
      console.error(
        '[e2e-teardown] the shared superadmin session was revoked during this run. Every ' +
          'spec that started after the revocation saw the login page. Run ' +
          '`npx playwright test -c apps/admin-e2e/playwright.contract.config.ts` to find ' +
          'the spec responsible.',
      );
      process.exitCode = 1;
    }
  } catch {
    // API already down. Nothing to report.
  }
}

/**
 * The database this run seeded, resolved exactly as `global-setup.ts` does.
 *
 * Duplicated deliberately rather than imported: importing global-setup would
 * pull in Playwright's `request` and its docker helpers into teardown, and the
 * one thing this value must never do is drift toward whatever `.env` happens
 * to hold, which is the dev database.
 */
const TEST_DATABASE_URL =
  process.env['DATABASE_TEST_URL'] ??
  'postgresql://postgres:postgres@localhost:55433/merchants_engine_test';

export default async function globalTeardown(): Promise<void> {
  await reportSharedSessionState();

  // Best-effort backstop. After phase H2 the specs clean up after themselves,
  // except for shipping zones and tax zones, which have no DELETE endpoint at
  // all. This also catches the run that was interrupted or crashed before its
  // `finally` ran, which is how rows a cleanup was supposed to remove ended up
  // in the dev database anyway.
  //
  // `sweepTestFixtures` refuses any database whose name does not end in
  // `_test`, and never throws: turning a green suite red in its own
  // housekeeping would be worse than the leftovers.
  // eslint-disable-next-line no-console
  await sweepTestFixtures(TEST_DATABASE_URL, (message) => console.log(message));

  if (existsSync(API_PID_PATH)) {
    const pid = Number(readFileSync(API_PID_PATH, 'utf8').trim());
    if (Number.isFinite(pid)) {
      // eslint-disable-next-line no-console
      console.log(`[e2e-teardown] killing api pid=${pid}`);
      killPid(pid);
    }
  }

  // Leave docker-compose services running between watch runs — 30 s cold
  // start isn't worth paying every save. CI teardown is a separate step in
  // the workflow file and can opt into `docker-compose down -v`.
  //
  // Keep the state dir around — api.log is the only breadcrumb we have
  // when the API fails to boot, and the PID file will be stale-but-harmless
  // for the next run since globalSetup rewrites it.
}
