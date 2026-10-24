import * as path from 'node:path';
import { defineConfig } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

/**
 * Service contract tests — Angular admin services ⇄ real NestJS backend.
 *
 * Unlike `admin-e2e` these tests do NOT drive a browser. We use Playwright's
 * `request` fixture to hit the API directly and validate every response
 * through the same Zod schemas the Angular services use at runtime. If the
 * backend drifts from the schema, the Angular client would throw at parse
 * time — these tests catch that drift before it ships.
 *
 * Lifecycle (managed by Playwright):
 *   1. globalSetup — `docker compose up -d` + `prisma db push` + `prisma db seed`.
 *   2. webServer  — `nx serve api`, waits for http://localhost:53000 to respond.
 *   3. specs      — run serially (workers=1) since they share a seeded DB.
 *   4. teardown   — Playwright kills the webServer; docker/db are left as-is
 *                   (the next run will re-seed in globalSetup).
 *
 * Escape hatches:
 *   - SKIP_E2E_SETUP=1 skips docker + db reset (spec-iteration speed run).
 *   - API_BASE_URL=https://host overrides the default localhost:53000.
 *   - REUSE_API=1 skips webServer (API already running in another terminal).
 */
const baseURL = process.env['API_BASE_URL'] || 'http://localhost:53000';

export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src/specs' }),
  globalSetup: path.resolve(__dirname, 'src/global-setup.ts'),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Resolve-Locale': 'false',
    },
    trace: 'retain-on-failure',
  },
  webServer:
    process.env['REUSE_API'] === '1' || process.env['API_BASE_URL']
      ? undefined
      : {
          command: 'npx nx serve api',
          url: `${baseURL}/health`,
          reuseExistingServer: !process.env['CI'],
          cwd: workspaceRoot,
          timeout: 180_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
  projects: [
    {
      name: 'service-contracts',
    },
  ],
});
