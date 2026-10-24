/**
 * Lighthouse CI config for the merchants-engine storefront.
 *
 * Boots the production-build Analog Nitro server on port 53311 via the
 * `serve-production` Nx target (SH6). The target's `dependsOn: ["build"]`
 * runs `nx build storefront --configuration=production` first, then
 * `node dist/apps/storefront/analog/server/index.mjs` with PORT=53311 +
 * NITRO_PORT=53311. Production-build measurement is the SH6 deliverable
 * per DR-14 Decision section + agent_docs/storefront/quality-gates.md
 * "Performance budgets" + clarifications §1.21 (target naming + port
 * correction).
 *
 * Pre-SH6 history: the runner pointed at `nx serve storefront --port=53311`
 * (Vite dev server) per the dev-server compromise recorded at
 * agent_docs/storefront/quality-gates.md.
 * SH6 closes that deferral.
 *
 * URLs cover the five representative routes per the canonical CI test
 * seed (`scripts/seed-storefront-test.ts`). `ar` only — the budget is
 * per-route not per-locale (the second locale ships from the same
 * bundle, so it cannot have a different First Load JS). The fx-*
 * category + product slugs require the test seed to be planted in
 * whichever DB the storefront API points at; on Windows hosts where the
 * test API spawn is broken per `storefront-ssr-data-hydration/clarifications.md`
 * §1.22, run LHCI in CI (which spawns the test API + seed) rather than
 * locally.
 *
 * Assertion thresholds mirror agent_docs/storefront/quality-gates.md
 * "Performance budgets" with the SH6 tightening:
 * - perf floor 0.85 → 0.9 (global)
 * - LCP 2500 ms → 1800 ms on home + product surfaces only (assertMatrix)
 *   — category, cart, checkout stay at 2500 ms because they were not
 *   migrated to the SSR populated-content gate
 * - CLS 0.1, TBT 200 ms, server-response 600 ms unchanged
 */

const apiBase = process.env.STOREFRONT_API_URL ?? 'http://localhost:53001/api';
const apiPrefix = process.env.STOREFRONT_API_TARGET_PREFIX ?? '';

// Force the production server spawned by `startServerCommand` to inherit
// the resolved API URL + prefix even when the caller did not export them
// explicitly. Without this, two of the five Lighthouse URLs (the
// `fx-audio` category + the `fx-laptop-pro-16-studio` product) measure
// 404 pages on machines whose API DB is not seeded with the fixture catalogue.
process.env.STOREFRONT_API_URL = apiBase;
process.env.STOREFRONT_API_TARGET_PREFIX = apiPrefix;

module.exports = {
  ci: {
    collect: {
      // Production-build target via the new SH6 `serve-production` Nx
      // target. `dependsOn: ["build"]` chains the production build first
      // (project.json `build.defaultConfiguration: "production"`), then
      // boots `node dist/apps/storefront/analog/server/index.mjs` with
      // PORT + NITRO_PORT = 53311. Two-step is fine for CI per
      // clarifications Q-7.
      startServerCommand: 'npx nx run storefront:serve-production',
      // Nitro server logs `Listening on http://[::1]:53311` once ready.
      startServerReadyPattern: 'Listening on',
      startServerReadyTimeout: 180_000,
      url: [
        'http://localhost:53311/ar/',
        'http://localhost:53311/ar/catalog/fx-audio',
        'http://localhost:53311/ar/catalog/product/fx-laptop-pro-16-studio',
        'http://localhost:53311/ar/cart',
        'http://localhost:53311/ar/checkout',
      ],
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        formFactor: 'desktop',
        screenEmulation: { disabled: true },
        throttling: { cpuSlowdownMultiplier: 1 },
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      // SH6: per-URL assertions via assertMatrix. lhci-utils requires
      // that when `assertMatrix` is used, the global `assertions` /
      // `preset` blocks are absent (verified by the
      // "Cannot use assertMatrix with other options" runtime error in
      // @lhci/utils/src/assertions.js:465). The catch-all entry at the
      // end carries the shared assertions; SH6-tightened entries above
      // it override LCP for the SSR-populated home + product surfaces.
      //
      // SH6 bumps perf 0.85 → 0.9 per quality-gates.md "Performance
      // budgets" + clarifications §1.7. LCP tightens 2500 → 1800 on
      // home + product per plan SH6 task 4. CLS / TBT / server-response
      // unchanged. Category / cart / checkout stay at LCP 2500.
      // lhci-utils applies EVERY matching assertMatrix entry to a URL,
      // not just the first. Patterns must be mutually exclusive to
      // avoid duplicate failure rows. The catch-all uses a negative
      // lookahead to skip URLs already covered by the SSR-populated
      // home + product entries above.
      assertMatrix: [
        {
          matchingUrlPattern: '/ar/$',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:accessibility': ['error', { minScore: 0.95 }],
            'categories:best-practices': ['warn', { minScore: 0.9 }],
            'categories:seo': ['warn', { minScore: 0.9 }],
            'largest-contentful-paint': ['error', { maxNumericValue: 1800 }],
            'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
            'total-blocking-time': ['error', { maxNumericValue: 200 }],
            'server-response-time': ['error', { maxNumericValue: 600 }],
          },
        },
        {
          matchingUrlPattern: '/ar/catalog/product/',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:accessibility': ['error', { minScore: 0.95 }],
            'categories:best-practices': ['warn', { minScore: 0.9 }],
            'categories:seo': ['warn', { minScore: 0.9 }],
            'largest-contentful-paint': ['error', { maxNumericValue: 1800 }],
            'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
            'total-blocking-time': ['error', { maxNumericValue: 200 }],
            'server-response-time': ['error', { maxNumericValue: 600 }],
          },
        },
        {
          matchingUrlPattern: '^(?!.*(?:/ar/$|/ar/catalog/product/)).*$',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:accessibility': ['error', { minScore: 0.95 }],
            'categories:best-practices': ['warn', { minScore: 0.9 }],
            'categories:seo': ['warn', { minScore: 0.9 }],
            'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
            'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
            'total-blocking-time': ['error', { maxNumericValue: 200 }],
            'server-response-time': ['error', { maxNumericValue: 600 }],
          },
        },
      ],
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
  /** Exposed for verifier specs that diff intent vs config. */
  __meta: {
    apiBase,
    apiPrefix,
  },
};
