import { defineConfig } from '@playwright/test';

/**
 * Source-level guards only: no browser, no server, no global setup.
 *
 * `fixture-contract.spec.ts` reads the spec sources off disk and asserts a
 * harness invariant. It runs inside the normal suite too (it sits under
 * `src/modules/`, which `authed-desktop` matches), but the full config spawns
 * an API and an admin dev server, which this guard does not need and which
 * makes it awkward to canary. This config runs it on its own in a second.
 *
 *   npx playwright test -c apps/admin-e2e/playwright.contract.config.ts
 */
export default defineConfig({
  testDir: './src/modules',
  testMatch: /fixture-contract\.spec\.ts$/,
  reporter: [['list']],
  workers: 1,
  retries: 0,
});
