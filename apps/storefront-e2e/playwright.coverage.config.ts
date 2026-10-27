import { defineConfig } from '@playwright/test';

/**
 * Source-level guard only: no browser, no server, no global setup.
 *
 * `project-coverage.spec.ts` reads the real config off disk and asserts every
 * spec file is collected by some project. It runs inside the normal suite too,
 * but the full config boots an API and a Vite dev server, which this guard does
 * not need and which makes it slow to canary.
 *
 *   npx playwright test -c apps/storefront-e2e/playwright.coverage.config.ts
 */
export default defineConfig({
  testDir: './src',
  testMatch: /project-coverage\.spec\.ts$/,
  reporter: [['list']],
  workers: 1,
  retries: 0,
});
