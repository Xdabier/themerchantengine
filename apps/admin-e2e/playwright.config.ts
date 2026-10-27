import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';
import { resolve } from 'node:path';
import { isWarm } from './e2e-server-marker.cjs';

// Port overrides for hosts where the OS reserves the defaults (a Windows
// Hyper-V dynamic-port exclusion can cover 53001 or 53211). ADMIN_DEV_PORT
// moves the admin dev server, E2E_API_PORT moves the test API; the launcher
// below generates the proxy config from both, and `global-setup.ts` reads the
// same E2E_API_PORT for the spawn and the identity guard.
//
// There is deliberately no way to point this suite at the dev stack. The knob
// that did (PLAYWRIGHT_SKIP_LIVE_BACKEND, with proxy.conf.e2e.dev.json behind
// it) wrote e2e fixtures into the dev database for two weeks; plan H removed
// it and replaced its only legitimate use, the port clash, with the overrides
// above. BASE_URL is gone with it: it was a third way to aim the suite at any
// origin, and the identity guard would now abort such a run anyway.
const ADMIN_DEV_PORT = process.env['ADMIN_DEV_PORT'] ?? '53211';
const E2E_API_PORT = process.env['E2E_API_PORT'] ?? '53001';
const baseURL = `http://localhost:${ADMIN_DEV_PORT}`;
const STORAGE_STATE = resolve(__dirname, '.playwright-state', 'storage-state.json');

/**
 * Responsive viewport matrix per constitution §3. Every e2e spec runs across all
 * viewports unless it is explicitly scoped to one via `test.use({ project })`.
 *
 * Live-backend e2e: `global-setup.ts` boots docker-compose test Postgres +
 * Redis, syncs Prisma, seeds the superadmin user, spawns the NestJS API on
 * :53001, logs in, and snapshots the refresh cookie into
 * `.playwright-state/storage-state.json`. The admin dev server proxies
 * `/api` → `localhost:53001` so specs hit a real backend without CORS
 * gymnastics.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  globalSetup: resolve(__dirname, 'global-setup.ts'),
  globalTeardown: resolve(__dirname, 'global-teardown.ts'),
  use: {
    baseURL,
    // The admin has two colour modes (constitution §3.9). With no stored
    // `admin-theme` preference the boot script follows `prefers-color-scheme`,
    // and Playwright's own default for that media query is `light` — so
    // leaving this unset would have silently re-rendered every recorded
    // baseline and every axe run in light mode the moment the mode landed.
    // Dark is the reference floor, so dark is what an unpinned spec gets; a
    // light-mode spec opts in with `test.use({ colorScheme: 'light' })`.
    colorScheme: 'dark',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Opt-in video recording — set PW_VIDEO=on to capture every test.
    // Files land under `dist/.playwright/apps/admin-e2e/test-output/<test>/video.webm`.
    // Off by default because webm encoding adds ~5-10 s per test.
    video:
      process.env['PW_VIDEO'] === 'on' ? { mode: 'on', size: { width: 1440, height: 900 } } : 'off',
  },
  webServer: {
    // A launcher, not a bare `nx serve`: it generates the /api proxy config
    // from E2E_API_PORT before starting Angular, so the port override needs no
    // committed proxy file per possible port and no ordering assumption about
    // when Playwright runs globalSetup.
    command: 'node apps/admin-e2e/serve-admin-e2e.mjs',
    url: `http://localhost:${ADMIN_DEV_PORT}`,
    // Never reuse a stale dev server: it may carry proxy.conf.json, which
    // points at :53000 (the dev API, and the dev database). The launcher
    // leaves a marker naming the ports it generated the proxy for and the pid
    // that owns it, so a server it started can be reused and nothing else can.
    // Reuse saves the 180-second Angular boot on every run after the first.
    reuseExistingServer: isWarm({ adminPort: ADMIN_DEV_PORT, apiPort: E2E_API_PORT }),
    cwd: workspaceRoot,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    // Public-route suite: unauthenticated (login, error pages, design system).
    // Runs without the storageState — these specs need no session.
    {
      name: 'public-desktop',
      testMatch: /(smoke|design-system|visual-regression)\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },

    // Authenticated suite: specs under src/modules/* use the auth fixture in
    // _auth-fixture.ts which seeds the Better Auth session cookies captured
    // by global-setup into every browser context (DR-24, BA3). Sessions are
    // server-side and replayable — all workers share the same cookie without
    // re-authenticating, avoiding the rate limiter on the test API.
    {
      name: 'authed-desktop',
      testMatch: /modules\/.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },

    // Authenticated mobile viewport: scoped to `authed-visual-regression.spec.ts`
    // per `agent_docs/admin/testing-strategy.md:121` ("Mobile viewport (Pixel 7
    // or iPhone 14)" gate for authed screens). Covers the stable-route subset
    // documented in that spec (account/settings/currencies/shipping-countries/
    // roles/staff). Full mobile coverage of every journey spec is out of scope
    // for R7 — journeys rely on desktop-breakpoint interaction patterns
    // (drag-reorder, side-by-side dialogs) that do not render on 390 px.
    // Opt-in via `--project authed-mobile`.
    {
      name: 'authed-mobile',
      // The light-mode baselines, the contrast probe and the shell-identity
      // journey join it: the mode is where a colour regression hides, a probe
      // that only ever ran at 1440 would be a viewport matrix of one, and the
      // topbar identity is the part of the shell a narrow viewport reflows.
      testMatch:
        /modules\/(authed-visual-regression|light-mode-baselines|contrast-probe|shell-identity\.journey)\.spec\.ts$/,
      use: { ...devices['Pixel 7'] },
    },

    // Full-viewport matrix for the public suite (visual regression + smoke).
    // Heavy; gate behind `--project` when you want it.
    {
      name: 'desktop-chromium-1440',
      testMatch: /(smoke|design-system|visual-regression)\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-firefox-1440',
      testMatch: /(smoke|design-system|visual-regression)\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-webkit-1440',
      testMatch: /(smoke|design-system|visual-regression)\.spec\.ts$/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chrome',
      testMatch: /(smoke|design-system|visual-regression)\.spec\.ts$/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      testMatch: /(smoke|design-system|visual-regression)\.spec\.ts$/,
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'tablet-ipad',
      testMatch: /(smoke|design-system|visual-regression)\.spec\.ts$/,
      use: { ...devices['iPad Pro 11'] },
    },
  ],
});
