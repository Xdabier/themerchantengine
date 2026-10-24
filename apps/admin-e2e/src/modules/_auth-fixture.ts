import { test as base, type BrowserContext, type WorkerInfo } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertTestTarget } from '../../../../scripts/e2e-identity-guard';

/**
 * Better Auth session fixture (DR-24, BA3).
 *
 * Seeds the Better Auth session cookies captured by global-setup into every
 * browser context before the test runs. The cookies come from the one
 * `sign-in/email` call that global-setup made — Better Auth sessions are
 * replayable (they are server-side sessions keyed on the session token, NOT
 * single-use JWTs), so every worker can share the same cookie without
 * re-authenticating.
 *
 * This replaces the previous approach of calling sign-in fresh per test,
 * which hit the Better Auth rate-limiter (429) when 8 workers signed in
 * simultaneously at suite start.
 *
 * If storage-state.json is absent (first run, before a session has been
 * captured), the fixture throws a clear message so the developer knows to run
 * global-setup first.
 */

const STORAGE_STATE_PATH = resolve(
  __dirname,
  '..',
  '..',
  '.playwright-state',
  'storage-state.json',
);

interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

function loadSessionCookies(): StorageCookie[] {
  if (!existsSync(STORAGE_STATE_PATH)) {
    throw new Error(
      `[auth-fixture] storage-state.json not found at ${STORAGE_STATE_PATH}. ` +
        'Run the suite once so global-setup can capture it.',
    );
  }
  const raw = readFileSync(STORAGE_STATE_PATH, 'utf8');
  const state = JSON.parse(raw) as { cookies: StorageCookie[] };
  const sessionCookies = state.cookies.filter((c) => c.name.startsWith('better-auth'));
  if (!sessionCookies.length) {
    throw new Error(
      '[auth-fixture] storage-state.json contains no better-auth cookies. ' +
        'Delete the file and re-run global-setup to capture a fresh session.',
    );
  }
  return sessionCookies;
}

async function seedCookies(ctx: BrowserContext): Promise<void> {
  const cookies = loadSessionCookies();
  await ctx.addCookies(cookies);
}

/**
 * The unwritten precondition of the shared-session design: nothing revokes it.
 *
 * A spec that signs out, or changes the superadmin's password, deletes the one
 * `Session` row every worker replays. That used to surface as a login-page
 * screenshot in whichever file happened to be running five minutes later,
 * because `cookieCache.maxAge` is 300 s and the signed `session_data` cookie
 * keeps answering `getSession` from memory with no database read until it
 * expires. This probe deliberately presents ONLY `better-auth.session_token`
 * and omits `better-auth.session_data`, which forces the database path, so a
 * revocation is caught here and named rather than three minutes downstream.
 *
 * Worker-scoped and automatic: one round trip per worker, and it runs before
 * the worker's first test rather than being something a spec must remember.
 */
async function assertSharedSessionAlive(workerInfo: WorkerInfo): Promise<void> {
  const token = loadSessionCookies().find((c) => c.name === 'better-auth.session_token');
  if (!token) {
    throw new Error(
      '[auth-fixture] storage-state.json has no better-auth.session_token. ' +
        'Delete the file and re-run global-setup to capture a fresh session.',
    );
  }

  const baseURL = workerInfo.project.use.baseURL;
  if (!baseURL) return; // no server to ask; loadSessionCookies already validated the file

  let payload: unknown;
  try {
    const res = await fetch(`${baseURL}/api/v1/auth/get-session`, {
      headers: { Cookie: `${token.name}=${token.value}` },
    });
    payload = res.ok ? await res.json() : null;
  } catch {
    // A dead API is global-setup's problem, not this guard's. Let the test
    // fail on its own assertion rather than masking it with a session error.
    return;
  }

  // Better Auth answers 200 with a null body for a revoked session, so the
  // status alone proves nothing. The user id is the assertion.
  const user = (payload as { user?: { id?: string } } | null)?.user;
  if (!user?.id) {
    throw new Error(
      '[auth-fixture] the shared superadmin session is dead. A spec running on this ' +
        'fixture revoked it: it signed out, changed the superadmin password, or otherwise ' +
        'deleted the Session row that every worker replays. Find it with ' +
        '`npx playwright test -c apps/admin-e2e/playwright.contract.config.ts`, which ' +
        'checks that contract over the spec sources.',
    );
  }
}

/**
 * The last gate before a spec writes, and the only one that sees the base URL
 * the spec will actually use.
 *
 * `global-setup.ts` checks the API it spawned. That is not the same question:
 * the specs reach the API through the admin dev server's `/api` proxy, and the
 * proxy's target is decided by a config file, an env override, or a stale
 * server Playwright adopted. Every historical leak took that seam — a
 * `proxy.conf` pointed at 53000, a `BASE_URL` aimed at the dev admin — and
 * global-setup was blameless in all of them, because the API it checked was
 * never the one the specs talked to.
 *
 * So this asks the same fail-closed question through `baseURL` itself, once
 * per worker, before the worker's first test. Memoized: the answer cannot
 * change mid-run, and paying one round trip per worker is the whole cost.
 */
let identityProbe: Promise<unknown> | undefined;

async function assertTargetIsTestStack(workerInfo: WorkerInfo): Promise<void> {
  const baseURL = workerInfo.project.use.baseURL;
  if (!baseURL) {
    throw new Error(
      '[auth-fixture] the project has no baseURL, so the target cannot be identified. ' +
        'Refusing to run rather than writing somewhere unknown.',
    );
  }
  identityProbe ??= assertTestTarget(`${baseURL}/api`, 'auth-fixture');
  await identityProbe;
}

/** No test-scoped fixtures of our own; the probe below is worker-scoped. */
type NoTestFixtures = Record<never, never>;

export const test = base.extend<NoTestFixtures, { sharedSessionAlive: void }>({
  sharedSessionAlive: [
    // Playwright requires the fixtures argument to be a destructuring pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      // Target first: a session probe against the wrong stack would answer
      // happily and tell the developer nothing.
      await assertTargetIsTestStack(workerInfo);
      await assertSharedSessionAlive(workerInfo);
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  context: async ({ context }, use) => {
    await seedCookies(context);
    await use(context);
  },
});

export { expect } from '@playwright/test';
