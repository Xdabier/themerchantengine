import { execSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Global setup for admin-services-e2e.
 *
 * Runs ONCE before the Playwright test run:
 *   1. `docker compose up -d` — postgres + redis (idempotent; no-op if already up).
 *   2. `prisma db push --force-reset` — rebuilds the schema from scratch on
 *      the dev DB. Safe per the project's test-ops policy: dev DB is
 *      destroyable, test DB is on a separate port/container.
 *   3. `prisma db seed` — populates deterministic test users + fixtures
 *      mirrored by apps/admin-services-e2e/src/fixtures/test-users.ts.
 *
 * The API itself is started by playwright.config.ts::webServer so its
 * lifecycle is managed by Playwright (including teardown). We deliberately
 * keep setup here narrow — just DB + seed — to avoid racing the API against
 * an unseeded schema.
 *
 * Set SKIP_E2E_SETUP=1 to bypass (useful during spec iteration when the DB
 * is already in a known state).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env['SKIP_E2E_SETUP'] === '1') {
    console.log('[e2e-setup] SKIP_E2E_SETUP=1 — skipping docker + db reset');
    return;
  }

  const repoRoot = path.resolve(__dirname, '../../..');
  const run = (cmd: string, description: string) => {
    console.log(`[e2e-setup] ${description}`);
    try {
      execSync(cmd, { cwd: repoRoot, stdio: 'inherit' });
    } catch (err) {
      throw new Error(`[e2e-setup] Failed: ${description}\n${(err as Error).message}`);
    }
  };

  run('docker compose up -d', 'docker compose up -d (postgres + redis)');
  run('npx prisma db push --accept-data-loss', 'prisma db push (apply schema)');
  run('npx ts-node prisma/seed.ts', 'prisma seed (direct ts-node invocation)');
}
