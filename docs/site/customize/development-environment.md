---
title: Development environment
description: "Running the engine from a checkout: the docker services, the database commands, the seeds and the three store fixtures, the dev servers, the test stack, the three e2e harnesses and the traps each one guards against."
primaryQuery: nestjs angular nx monorepo local development setup docker postgres redis
updated: 2026-09-09
schema: TechArticle
---

This page is for changing the engine. If you want a running store on a laptop, run the installer under its local profile instead: [Install locally](../getting-started/install-locally.md). The two coexist; the installer keeps its own environment files under `deploy/local/` and never touches the `.env` a checkout uses.

## Prerequisites

- Node 22 (`.nvmrc`) and npm. `npm install` at the root installs every workspace dependency; there is no install step per app.
- Docker with Compose, for Postgres and Redis.
- OpenSSL on the path, to generate the session secret.
- Playwright's browsers, installed on first use of an e2e suite.

After `npm install`, run `npm run prisma:generate` once. Nothing runs it for you: `package.json` has no `postinstall` hook.

## The docker services

```bash
npm run docker:up      # docker-compose up -d
npm run docker:down
```

`docker-compose.yml` starts four containers: `postgres-dev` on 55432 (database `merchants_engine_dev`), `postgres-test` on 55433 (`merchants_engine_test`), `redis-dev` on 56379 and `redis-test` on 56380. Each has a health check and a named volume, so data survives a restart. `docker-compose down -v` wipes them.

## The environment file

```bash
cp .env.example .env
```

`.env.example` is written for exactly this setup: the dev database and Redis, `CORS_ORIGIN` listing the four local origins (53200, 53211, 53300, 53311), `API_GLOBAL_PREFIX=api` (`apps/admin/proxy.conf.json` forwards `/api/*` without rewriting the path, and the storefront's Vite proxy prefixes `/v1` with `/api`, so without it every admin call answers 404), the three public base URLs on localhost, `MAIL_TRANSPORT=console` and `STORAGE_DRIVER=local`. Two edits:

- `BETTER_AUTH_SECRET`: replace the placeholder with `openssl rand -hex 32`. The API refuses to boot in production without one; in development it runs but every session is signed with a known string.
- Leave `NODE_ENV=development`. Only `development` and `test` unlock development behaviour; any other value, or none, reads as production (`libs/shared/common/src/env/runtime-environment.ts`).

## Database commands

All of these are `package.json` scripts and run against `DATABASE_URL` from `.env`, which `prisma.config.ts` loads.

- `npm run prisma:generate`: regenerate the Prisma client. Needed after every change to `prisma/schema.prisma`.
- `npm run db:push`: `prisma db push`, then `npm run db:fts`, then the order-status-history backfill. Use this, not `prisma db push` directly (see the traps below).
- `npm run db:setup`: the first-time shape of a database. `prisma db push --accept-data-loss`, the search setup, the notification-log indexes, the order-status backfill and `prisma generate`.
- `npm run db:fts`: applies `prisma/search_fts_setup.sql` through `prisma/apply-fts-setup.ts`: the `searchVector` column on `Product`, its trigger, the trigram indexes and a backfill. Idempotent, and it raises if any active product is left without a vector.
- `npm run prisma:migrate` (`prisma migrate dev`) and `npm run db:reset` (`prisma migrate reset`) exist in `package.json` but cannot run on this repository: the folders under `prisma/migrations/` do not start from an empty database, so the shadow replay fails with `P3006` before writing anything. The schema is applied with `db:push` everywhere and a migration folder is written by hand as a record; see [Add a model](./recipes/data/add-a-model.md). To start over, drop and recreate the database and run `npm run db:setup`.
- `npm run db:seed`: `prisma db seed`, which `prisma.config.ts` maps to `npx ts-node prisma/seed.ts`.
- `npm run db:seed:fixture-catalogue`: the storefront fixture catalogue on its own, `prisma/seeds/fixture-catalogue/cli.ts`.
- `npm run db:flush-cache`: drops the Redis money-format cache after a currency or precision change.

## Seeds and store fixtures

`prisma/seed.ts` is one idempotent script that upserts roles and their permissions from the catalogue, four staff accounts (`superadmin@merchants.test` with the password `Admin123!` is the one the admin e2e harness signs in with), a demo catalogue with orders and reviews, the notification templates, the payment methods, and shipping and tax from the store's configuration. It is destructive on purpose: it hard-deletes every order, review, user and gift card it did not seed, so the database returns to a known baseline. It therefore refuses to run on any database other than `merchants_engine_test` unless `SEED_DEV_OK=1` is set:

```bash
SEED_DEV_OK=1 npm run db:seed
```

Which store the seed shapes comes from `STORE_CONFIG_FIXTURE`, one of the three fictional configurations under `test/fixtures/store-configs/` (`test/fixtures/store-configs/README.md` describes them):

- `demo`: `en` default plus `fr`, both left-to-right, a two-decimal currency with the symbol after the number, prices shown tax-included. The baseline every visual-regression snapshot was recorded under.
- `gulf-rtl`: `ar` default plus `en`, `ar` right-to-left, the Arabic-capable font kit, five percent VAT, a Gulf address shape with no postcode.
- `maghreb-ltr`: `fr` default plus `en`, the Latin font kit, a three-decimal currency with a narrow no-break space as thousands separator, nineteen percent VAT, prices shown tax-excluded.

`STORE_CONFIG_FIXTURE=gulf-rtl SEED_DEV_OK=1 npm run db:seed` seeds a right-to-left store; with the variable unset the seed keeps whatever configuration the database already holds, or the neutral one on an empty database. `FIXTURE_CATALOGUE_SEED=1` adds the storefront e2e catalogue (`fx-` slugs, about thirty-six products in five categories, `prisma/seeds/fixture-catalogue/README.md`) at the end of the same run. The fixtures carry no real store, and `npm run verify:no-client-refs` scans the tree to keep it that way.

`prisma/seed-roles-only.ts` creates the four roles with their grants and nothing else: no users, no catalogue, no demo data. It is what a new production database gets.

## Running the applications

Three terminals:

```bash
npx nx serve api           # http://localhost:53000, routes under /api/v1, Swagger at /api/docs
npx nx serve admin         # http://localhost:53200, /api proxied to 53000
npx nx serve storefront    # http://localhost:53300, /v1 proxied to 53000/api/v1
```

`npm run start:dev` is the same as `npx nx serve api`. The API logs JSON; pipe it through `npx pino-pretty` to read it. The storefront reads the store's identity, brand, locales and money from `GET /api/v1/store/config` at request time, so the API must be up before the storefront renders anything.

## The test stack

Tests never touch the dev pair. The backend e2e suite reads `DATABASE_TEST_URL` and `REDIS_TEST_PORT` (`test/e2e/env.ts`); both Playwright suites fall back to the same 55433 and 56380 values when the variables are unset. Every harness spawns its own API on 53001 with `NODE_ENV=test` and reseeds `merchants_engine_test` in its global setup, so a run starts from the same baseline every time.

Before a single spec runs, each harness calls `assertTestTarget` from `scripts/e2e-identity-guard.ts`, which asks the API on the test port `GET /v1/health/identity` and aborts unless it answers `env: "test"` with a database name ending in `_test`. `/health` alone cannot tell a dev API from a test one, which is why the identity route exists (`apps/api/src/health/health.controller.ts`).

## The three e2e harnesses

- **Backend, Supertest**: `npm run test:e2e`, which is `nx e2e api --forceExit` with `test/jest.e2e.config.ts`. `test/e2e-global-setup.ts` pushes the schema to the test database, reapplies the search setup, seeds, flushes the test Redis, then runs the built bundle `dist/apps/api/main.js` on 53001 with an empty `API_GLOBAL_PREFIX`; `npx nx build api` first. Specs are HTTP clients under `test/e2e/`; Jest never imports the Nest app.
- **Admin, Playwright**: `npx nx e2e admin-e2e`, `apps/admin-e2e/playwright.config.ts`. `apps/admin-e2e/global-setup.ts` starts the two test containers, drops and recreates the schema, seeds, builds the API, runs it on 53001 under the `api` prefix, signs in as the superadmin and saves the session cookie for every spec. The admin dev server runs on 53211 through `apps/admin-e2e/serve-admin-e2e.mjs`, which writes a proxy config pointing at 53001. Specs live in `apps/admin-e2e/src/modules/` as `*.journey.spec.ts` and hit the real API; no route mocking.
- **Storefront, Playwright**: `npx nx e2e storefront-e2e`, `apps/storefront-e2e/playwright.config.ts`. Playwright itself spawns two servers: `nx serve api` on 53001 with the `api` prefix against the test database, and the storefront dev server on 53311 pointed at it. `apps/storefront-e2e/src/global-setup.ts` seeds through `scripts/seed-storefront-test.ts` (the baseline seed plus the fixture catalogue), flushes the test Redis, runs the identity guard and checks that the sitemap the API emits names this run's host.

All three read `STORE_CONFIG_FIXTURE` and default to `demo`. Set it to `gulf-rtl` or `maghreb-ltr` to run a suite under another store.

## The one hard rule

Never run two harnesses at the same time. All three reseed the same `merchants_engine_test` on 55433 and all three want port 53001 for an API they configure differently (the backend suite runs it unprefixed, the other two under `/api`). A second harness starting mid-run reseeds the database the first is asserting on, and adopts or collides with the first one's API. Every harness's port guard names "a stopped storefront-e2e run" or "another harness" as the usual squatter, because that is what it was.

## Known traps

- **A stale listener on 53001 fails every request.** `/health` sits outside the global prefix, so a leftover API answers it whatever prefix and database it was started with. `test/e2e-global-setup.ts` therefore probes a real route (`isOurApi`) and refuses a server that 404s it; `apps/admin-e2e/global-setup.ts` refuses to spawn onto an occupied port (`assertPortFree`) after killing its own recorded pid once; `apps/storefront-e2e/src/global-setup.ts` compares the host in the API's sitemap with this run's base URL. When one of them stops you, stop the process it names. On Windows, kill the process tree, not the port.
- **A bare `prisma db push` breaks search and every product write.** The `searchVector` column and its trigger live in `prisma/search_fts_setup.sql`, not in `prisma/schema.prisma`, so a push drops the column and leaves the trigger `product_search_vector_trig` attached. From then on search returns nothing and every product create or edit fails with a 500. `apps/api/src/bootstrap/fts-integrity.ts` refuses to boot a dev or test API in that state and names the repair: `npm run db:fts`. `npm run db:push` chains it for you, and every harness reapplies it after its own push.
- **The storefront harness must see the test Redis.** `apps/storefront-e2e/playwright.config.ts` passes `REDIS_PORT` from your shell to the API it spawns and only falls back to 56380 when the shell has none. A shell that exported the dev value (56379) sends the test API's caches, rate limits and idempotency keys to the dev Redis. Do not export `REDIS_PORT` in the shell you run the suite from, or export `REDIS_PORT=56380`.
- **Select storefront specs with `--grep`.** The Nx Playwright executor exposes Playwright's `grep` option and a `testFiles` option, and passes them through; a bare file path after the project name is not an option it knows. `npx nx e2e storefront-e2e --grep=checkout` runs the checkout journey. Playwright's `--project` is exposed too.
- **The admin button takes a `testId` input.** `libs/admin-ui/src/atoms/button/button.component.ts` binds `[attr.data-testid]="testId()"` on the inner `<button>`; a `data-testid` attribute written on `<app-button>` lands on the wrapper element, which is not what a click targets. Pass `testId="save"` and select `[data-testid="save"]`.
- **The seed refuses the dev database.** `prisma/seed.ts` exits with a message naming `SEED_DEV_OK=1` when `DATABASE_URL` is not the test database. That is the guard working; set the variable when you mean it.
- **A Redis cache outlives a reseed.** The API caches sections, sitemaps and product lists in Redis. Every harness flushes the test Redis after seeding; on the dev pair a reseed leaves the dev Redis as it was, so a page can show a catalogue that no longer exists until the keys expire or you flush `redis-dev`.
- **Windows can reserve a 5xxxx port.** Hyper-V's dynamic exclusion range sometimes covers 53001 or 53211. The knobs are `E2E_API_PORT` and `ADMIN_DEV_PORT` for the admin suite, `STOREFRONT_E2E_API_PORT` and `STOREFRONT_DEV_PORT` for the storefront suite. There is deliberately no knob that points a suite at the dev stack.

## Unit tests and lint

```bash
npx nx test api            # Jest
npx nx test admin          # Jest with jest-axe
npx nx test storefront     # Vitest
npm test                   # every project's unit tests, two in parallel
npx nx lint api
npm run test:scripts       # the repository scripts, this docs site's guard included
```

What each gate proves and which ones block a release is on [Testing and gates](./testing-and-gates.md).
