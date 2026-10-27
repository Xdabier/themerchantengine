---
title: Testing and gates
description: 'The commands to run before a change ships, per application, what each one proves, what CI refuses on a push, and the rules the e2e harnesses hold: one harness at a time on the test database, a fail-closed identity check on the API, no skips, no route mocks.'
primaryQuery: nestjs angular playwright monorepo test gates ci
updated: 2026-09-09
schema: TechArticle
---

Every application in the monorepo has a unit runner, a linter, a production build and an end-to-end suite, and CI runs all of them on every push. This page lists the commands, says what each proves and what it cannot prove, and explains the rules the three e2e harnesses share. The unit runners skip type-checking on purpose, so the production builds are gates too, not packaging steps.

Every e2e command needs the test services up first:

```bash
npm run docker:up   # postgres-test on 55433, redis-test on 56380, plus the dev pair
```

## API

```bash
npx nx test api
npx nx lint api
npm run test:e2e
```

- `npx nx test api` runs Jest on `apps/api/src/**/*.spec.ts`, `apps/api/scripts/*.spec.ts` and the root `scripts/*.spec.ts`, per `apps/api/jest.config.ts`. It uses ts-jest with `isolatedModules: true`, so a type error does not fail a spec; type-checking lives in `npx nx build api`. The config sets `collectCoverageFrom` but no `coverageThreshold`, and `jest.preset.js` adds none, so `npm run test:cov` prints a report and nothing refuses a low number. The 80 percent floor per module is a review rule, not a config. One spec, `apps/api/src/modules/geo/geo.service.spec.ts`, is excluded by `testPathIgnorePatterns`.
- `npx nx lint api` lints `apps/api/**/*.ts` and `test/**/*.ts` (`apps/api/project.json`). `npm run lint` runs it together with the `common` library's lint.
- `npm run test:e2e` is `nx e2e api --forceExit`: Supertest specs matching `**/*.e2e-spec.ts` under `test/`, run in band against a real API. The target depends on `build`, so `dist/apps/api/main.js` is fresh. `test/e2e-global-setup.ts` pushes the schema to the test database with `--accept-data-loss`, re-applies the search index, runs `prisma/seed.ts` under the `demo` store fixture, backfills notification bodies and order history, flushes the test Redis, re-applies the two raw-SQL indexes, then spawns the built API on 53001 with `API_GLOBAL_PREFIX` empty and `NODE_ENV=test`. The API log is `test/.e2e-api.log`. The specs are HTTP clients; Jest never imports the Nest application.

## Admin

```bash
npx nx test admin
npx nx lint admin
npx nx build admin --configuration=production
npx nx e2e admin-e2e
```

- `npx nx test admin` runs Jest through `jest-preset-angular` with `isolatedModules: true` (`apps/admin/jest.config.ts`). A strict-template error, a wrong binding on a Zod-typed model, a missing input: none of these fail a unit spec. The Better Auth browser client is replaced by `apps/admin/src/testing/better-auth-client.mock.ts` in every spec.
- `npx nx build admin --configuration=production` is the AOT build with the budgets from `apps/admin/project.json`: initial bundle 750 kB warning and 900 kB error, any component style 4 kB and 8 kB, the `main` bundle 40 kB and 80 kB. It catches the template errors Jest misses and refuses a bundle that grew past the budget. Run it before every push that touches the admin; CI runs it as the `build` job.
- `npx nx e2e admin-e2e` is the Playwright suite in `apps/admin-e2e/playwright.config.ts`. `apps/admin-e2e/global-setup.ts` starts the test services, refuses a port 53001 held by a process it did not start (it kills only the pid recorded in `apps/admin-e2e/.playwright-state/api.pid`), drops and recreates the `public` schema of the test database, pushes the schema, re-applies the search index, runs `prisma/seed.ts`, builds the API with `--skip-nx-cache`, spawns it on 53001 under the `/api` prefix, checks its identity, signs in the seeded superadmin and stores the session cookies for every spec. The admin itself runs through `apps/admin-e2e/serve-admin-e2e.mjs` on 53211 with `reuseExistingServer: false`, so a dev server on 53200 with its proxy to the dev API is never adopted. The API log is `apps/admin-e2e/.playwright-state/api.log`. Journey specs live under `apps/admin-e2e/src/modules/` and run in the `authed-desktop` project; `authed-mobile` and the browser matrix are opt-in with `--project=<name>`. `ADMIN_DEV_PORT` and `E2E_API_PORT` move the two ports when the OS reserves them.

`npm run test:services-e2e` is a separate contract suite (`apps/admin-services-e2e/playwright.config.ts`) that targets `http://localhost:53000`, the dev API, and pushes the schema on whatever database `.env` names. It is not in CI and not in the list above.

## Storefront

```bash
npx nx test storefront
npx nx lint storefront
npx nx build storefront --configuration=production
npx nx e2e storefront-e2e --grep=<pattern>
npm run test:storefront-ssr-smoke
```

- `npx nx test storefront` runs Vitest through `apps/storefront/vite.config.ts`. Coverage uses the v8 provider with no threshold in the config.
- `npx nx build storefront --configuration=production` builds the Analog client and the Nitro server. No Playwright project runs this build, and the Nitro server code under `apps/storefront/src/server/` is bundled by Nitro's own esbuild pass without the Angular compiler, so a value import of a decorated service there fails only here. `scripts/__tests__/nitro-imports.spec.ts` guards that import shape statically; the build is the proof.
- `npx nx e2e storefront-e2e` boots two servers from `apps/storefront-e2e/playwright.config.ts`: the API on 53001 under `/api` with `NODE_ENV=test`, the test database, `DISABLE_THROTTLE=1` and `AUTH_SKIP_EMAIL_VERIFICATION=1`, and the Analog dev server on 53311. `apps/storefront-e2e/src/global-setup.ts` seeds through `scripts/seed-storefront-test.ts`, flushes the test Redis, checks the API's identity and then checks that the sitemap the API emits names this run's host. Set `REDIS_PORT=56380` in the shell, as the CI job does. Filter with `--grep=<pattern>`; the whole suite is long. `SKIP_SEED=1` skips the seed while you iterate on a spec. Three projects: `desktop-chromium-1440`, `mobile-chrome`, `mobile-safari`.
- `npm run test:storefront-ssr-smoke` runs the Nx target `storefront:verify-ssr-smoke`, which depends on the production build. `apps/storefront/tools/verify-ssr-smoke-runner.cjs` boots `dist/apps/storefront/analog/server/index.mjs` on 53311 and `apps/storefront/tools/verify-ssr-smoke.cjs` reads the served HTML with plain GETs: a filtered catalogue URL, a search URL, a category deep link, and the product page as a control. It is the only gate on the production request path, where page loaders resolve over an internal fetch rather than HTTP. It needs a seeded test API; the default base is `http://localhost:53001/api`, and `STOREFRONT_API_URL` moves it. It refuses to run when 53311 already answers and exits 2 when the API does not answer `/v1/health/identity`. Exit 1 is a page rendered wrong, exit 2 a harness or fixture problem.

To hold a seeded test API for the smoke the way CI does:

```bash
npx nx build api
npx ts-node --transpile-only -r tsconfig-paths/register -P tsconfig.base.json scripts/ci/hold-test-api.ts
# in a second shell, once it prints "hold-test-api: ready":
STOREFRONT_API_URL=http://localhost:53001 npm run test:storefront-ssr-smoke
```

`scripts/ci/hold-test-api.ts` reuses the backend e2e global setup, so the held API has no `/api` prefix; the env var above points the smoke at the bare origin.

## Repository scripts, the installer and the guards

```bash
npm run test:scripts
npm run verify:no-client-refs
npx nx test setup-cli
npx nx typecheck setup-cli
node tools/setup/verify-standalone.mjs
npm run test:store-config-seed
npm run test:fixture-catalogue-seed
```

- `npm run test:scripts` runs Vitest on `scripts/__tests__/**/*.spec.ts` and `scripts/*.spec.ts` (`scripts/vitest.config.ts`). The specs pin the CI workflow against the tree (`ci.spec.ts`), the deploy scripts and systemd units (`deploy-shared.spec.ts`), the Dockerfiles (`dockerfiles.spec.ts`), the public docs pages (`docs-site.spec.ts`), the security headers each edge vhost may not repeat (`edge-headers.spec.ts`), the inline secret-scan allow markers (`gitleaks-allows.spec.ts`), the Nitro import rule, the release script, the storefront proxy lines in every vhost and the two install wrappers. The Nx project name is `repo-scripts`, so `npx nx run-many -t test` includes it.
- `npm run verify:no-client-refs` scans every tracked and untracked-but-not-ignored text file for the tokens in its token table and fails on a hit outside its allowlist, or on an allowlist entry that matches nothing. `--list` prints the allowlisted hits, `--summary` counts per directory. The token file is left out of the release tarball, so on a tarball the command reports that it runs in the repository only.
- The setup CLI is the Nx project `setup-cli` (`tools/setup/project.json`): `test` is `npm run test:setup`, `typecheck` is `npm run typecheck:setup`, `build` is `npm run build:setup`. `node tools/setup/verify-standalone.mjs` copies the stepper and the shared sources to a scratch directory without the workspace `node_modules`, installs from the stepper's own lockfile, builds and runs the bundle's `--version`.
- The two seed suites have no Nx project; CI runs them by their npm scripts after `nx run-many -t test`.

## What CI runs on a push

`.github/workflows/ci.yml` runs on every push and every pull request, one job per gate, with a read-only token, and deploys nothing. A newer push to the same ref cancels a run in progress. The jobs, by name:

- `lint` refuses a lint error in any project: `nx run-many -t lint` for the applications, then `eslint:lint` for the libraries, the stepper, the scripts and the prisma project.
- `unit` refuses a failing unit spec in any project with a `test` target, then in the two seed suites.
- `verify-no-client-refs` refuses a client name, currency or place anywhere in the tree.
- `docs-generate-check` builds the API, regenerates `docs/site/reference/` from the code into a scratch directory and refuses any byte of difference from the committed tree, so a new route, permission, error code or env variable ships with its reference page or not at all. `npm run docs:generate` is the fix.
- `secret-scan` refuses a secret in the tree or in any commit reachable from the ref, with gitleaks pinned by digest; it first plants two keys in a scratch copy and refuses to continue unless the scanner reports exactly those two.
- `setup-standalone` refuses a stepper that cannot build from its own lockfile on a fresh clone.
- `nginx-templates` refuses a vhost template that `nginx -t` rejects, rendered for the server edge and for the local edge, and a compose template that `docker compose config` rejects, for all four profiles.
- `build` refuses a failing `nx build api`, an admin build over budget, a failing production storefront build, or a Lighthouse assertion failure on the admin's public routes.
- `backend-e2e` refuses a failing Supertest spec against the dockerized test database.
- `admin-e2e` refuses a failing admin journey in chromium, firefox or webkit.
- `storefront-e2e` refuses a failing storefront journey in chromium or webkit.
- `ssr-smoke` refuses a production Nitro build that renders a filtered page wrong against a seeded API held on 53001 by `scripts/ci/hold-test-api.ts`.
- `install-smoke` refuses an installer that cannot install the local profile on the runner's Docker from `ci/answers.local.json`, probes the installed store from outside the installer, then installs again and refuses a second run that does not end with the same closing lines.

## One harness at a time on the test database

The backend suite, the admin suite and the storefront suite share one database (`merchants_engine_test` on 55433), one Redis (56380) and one API port (53001). Each global setup rewrites that database before its first spec: the admin setup drops the `public` schema, the backend setup pushes and reseeds, the storefront setup reseeds and flushes Redis. Two of them at once means one suite's fixtures vanish under the other's specs, with failures that name a missing row rather than the cause. Run one, let it finish, run the next.

The storefront port 53311 is shared the same way by five processes: the storefront e2e dev server, `serve-production`, `verify-ssr-payloads`, `verify-ssr-smoke` and Lighthouse. The smoke runner refuses a port that already answers instead of testing whatever is listening.

A suite whose teardown never ran leaves its API on 53001. The admin harness names that case in its refusal; stop the leftover process tree before the next run.

## How a harness refuses a stale API

`/health` is registered outside the global prefix and returns `{ status, timestamp }`, so it answers 200 on a dev API, a production API and a stale build alike. The harnesses do not trust it. `GET /v1/health/identity` (`apps/api/src/health/health.controller.ts`) answers `{ data: { env } }`, and adds the database name only when `NODE_ENV` is `test`. Because it sits under `v1`, it picks up the global prefix, so each harness reaches it through the same base URL its specs use.

`scripts/e2e-identity-guard.ts` exports `assertTestTarget(apiBase, context)`, and all three harnesses call it before any spec writes. It never resolves on doubt: an unreachable URL, a 404 (an API too old to carry the route), any non-200, a non-JSON body, a missing `env`, an `env` other than `test`, or a database name that does not end in `_test` all abort the run with a message that names the port and the fix.

- `test/e2e-global-setup.ts` probes `/v1/products?pageSize=1` first, which is a 404 on a server started with the `/api` prefix, then the identity, and only then reuses a running API.
- `apps/admin-e2e/global-setup.ts` checks the identity through `http://localhost:53001/api` after `/health` passes and before it signs in.
- `apps/storefront-e2e/src/global-setup.ts` checks the identity, then reads `/v1/sitemap-products.xml` and refuses an API whose absolute URLs name a host this run is not serving.

There is no knob that points a suite at the dev stack. The overrides that exist move ports: `E2E_API_PORT`, `ADMIN_DEV_PORT`, `STOREFRONT_E2E_API_PORT`, `STOREFRONT_DEV_PORT`, `STOREFRONT_SMOKE_PORT`. `test/e2e/health-identity.e2e-spec.ts` pins the route at both addresses.

## Rules the suites hold

- No unconditional `test.skip`. The conditional form `test.skip(condition, reason)` appears where a journey is scoped to a viewport or a tier, for example the desktop-only cases in `apps/admin-e2e/src/modules/shell-identity.journey.spec.ts`. A few storefront journeys are gated on `STOREFRONT_E2E_BUILT`; nothing in `.github/workflows/ci.yml` sets it, so those run only when you set it yourself.
- No `page.route()`, no MSW, no fixtures inside a journey spec. Every journey drives the real API on the seeded test database. Nothing in the lint config enforces this; a review does.
- Every storefront journey attaches a console baseline from `apps/storefront-e2e/src/support` and asserts it clean after each test, runs its mutation and error paths under every locale of the active store fixture, and ends a mutation with a reload that asserts the state survived.
- Snapshot baselines under the `*.spec.ts-snapshots` directories are committed. Update them with `--update-snapshots` only for an intended visual change, and read the diff images CI uploads on failure before you do. CI runs both Playwright jobs inside `mcr.microsoft.com/playwright:v1.59.1-noble`, the image the Linux baselines were rendered in, because the bare runner's fonts render differently. Regenerate Linux baselines inside that image too.
