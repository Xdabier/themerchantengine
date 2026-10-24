# themerchantengine

End-to-end commerce platform: NestJS + Prisma backend, Angular 21 admin
dashboard and Analog.js storefront, organized as an Nx monorepo. One generic
build; every store-specific value (identity, brand, locales, currency,
domains, third-party keys) is entered once through the install stepper and
lives in the database and the environment.

**License in one paragraph.** The code is source-available under the
PolyForm Noncommercial License 1.0.0, which is neither MIT nor BSL. Unlike
MIT, it does not permit commercial use: you may read, run, change and share
it freely for personal, educational, research and nonprofit purposes, but a
store that earns money needs a commercial license from Badii Studio. Unlike
BSL, it never converts to an open-source license on a change date, and there
is no extra usage grant to interpret. [LICENSE](LICENSE) has the full text,
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) the commercial terms, and
[NOTICE](NOTICE) the required notice that must travel with every copy.

---

## Quickstart

Run the engine on your machine for development, with Node 22 and Docker
installed:

```bash
git clone https://github.com/Xdabier/themerchantengine.git
cd themerchantengine
npm install
npm run docker:up
cp .env.example .env               # then set BETTER_AUTH_SECRET, see below
npm run db:push
npm run db:seed
npx nx serve api                   # http://localhost:53000
npx nx serve admin                 # http://localhost:53200, second terminal
npx nx serve storefront            # http://localhost:53300, third terminal
```

Log in to the admin as `superadmin@merchants.test` with `Admin123!`. The
sections below explain each step.

---

## What is in the box

- Catalogue: products, variants, categories, inventory, reviews, search.
- Orders: cart, checkout, orders, returns, invoices, gift cards, promotions.
- Content: CMS pages, SEO, translatable fields in every locale you enable.
- Payments: Stripe, cash on delivery and manual payment.
- Mail: Resend, plus a console transport that logs mail for development.
- Storage: local disk or any S3-compatible bucket.
- Shipping: zones and methods with the rates you enter in the admin, and a
  carrier list for tracking links.

Planned, not built yet:

- More mail adapters, such as SMTP.
- Live shipping adapters that fetch carrier rates and labels.

---

## Repository Layout

```
themerchantengine/
├── apps/
│   ├── api/                   # NestJS backend (port 53000)
│   ├── admin/                 # Angular 21 admin dashboard (port 53200)
│   ├── admin-services-e2e/    # Admin-services integration e2e
│   └── storefront/            # Analog.js SSR customer storefront (port 53300)
├── libs/
│   ├── shared/common/         # Shared backend utilities
│   ├── admin-ui/              # Design-system primitives (atoms + organisms)
│   ├── admin-services/        # API services per admin module
│   └── admin-types/           # Shared types + Zod schemas
├── prisma/
│   └── schema.prisma          # Database schema
├── docs/site/                 # The public documentation site
├── scripts/                   # Setup, release and maintenance scripts
├── docker-compose.yml         # Dev/test PostgreSQL + Redis
└── lighthouserc.json          # Lighthouse CI thresholds
```

---

## Prerequisites

- **Node.js 22.x** + **npm** (use `nvm` or `volta` if you juggle versions).
- **Docker + Docker Compose**: brings up dev PostgreSQL 16 on `:55432` and
  test PostgreSQL on `:55433`, plus dev Redis on `:56379` and test Redis on
  `:56380`.
- **OpenSSL** on your shell `PATH`: used to generate the Better Auth
  signing secret below. Git Bash and WSL ship it by default on Windows.
- **Playwright browsers**: installed on demand the first time you run
  `npx nx e2e admin-e2e`. Skip until you actually run e2e.
- **Chrome on `PATH`**: only needed for `npm run lhci`. Skip otherwise.

---

## Installing a store

Two commands on a prepared Linux box:

```bash
git clone https://github.com/Xdabier/themerchantengine.git /srv/themerchantengine
cd /srv/themerchantengine && ./setup.sh
```

The stepper asks for the store's identity, brand, locales, money, storage,
mail, bot protection and owner account, verifies each third-party
integration live, and installs the whole stack. It ends with
`backend server installed successfully!` or
`storefront server installed successfully!`, the admin URL and the owner
login. The documentation site, themerchantengine.com/docs, is the full guide.
Its source is [docs/site/](docs/site/):

- [getting-started/](docs/site/getting-started/) says what to have ready,
  what the stepper asks and what to do in the first hour.
- [operate/](docs/site/operate/) is the manual for everything after.

The walkthrough the engine is built and tested against, an agency
developer with a server or two, a bucket, a domain and the third-party
accounts ready:

1. Clone the engine on the backend box, run `./setup.sh --profile engine`,
   answer the stepper, wait. The script ends with
   `backend server installed successfully!`.
2. Clone the engine on the storefront box (or use the same box with
   `--profile both`), run `./setup.sh --profile storefront`, answer the
   stepper, wait. The script ends with
   `storefront server installed successfully!`.
3. Hand the client the admin login. The store is live, empty, and ready for
   products and orders.
4. The same developer runs the same stepper on a laptop with Docker using
   `./setup.sh --local` (or `./setup.ps1` on Windows) for a local copy.

A release tarball from the repository host works the same way and skips the
stepper build, because the bundle ships inside it.

---

## Getting Started

What follows is the developer setup for working on the engine itself. The
platform is a monorepo: the API and the admin dashboard share the same
database, env file, and dependency tree. Follow the steps in order the
first time; everyday work is just `npm run start:dev` + `npx nx serve
admin` in two terminals.

### 1. Install

```bash
git clone https://github.com/Xdabier/themerchantengine.git
cd themerchantengine
npm install                        # installs root + all workspace deps
```

The public tree installs no git hooks (their scripts live in `.claude/`,
which the release leaves out), so run `npm run gate` before you push. The
Prisma client is generated in step 4.

### 2. Start infra (PostgreSQL + Redis)

```bash
npm run docker:up                  # PG dev :55432 + test :55433, Redis :56379 + :56380
docker ps                          # verify all four containers are healthy
```

### 3. Environment file

```bash
cp .env.example .env
```

Open `.env` and:

1. Leave `DATABASE_URL` and `REDIS_*` alone. The defaults match the
   containers.
2. Set `BETTER_AUTH_SECRET` to a fresh random 32-byte hex string. Better
   Auth signs every session cookie with this HMAC key; the API refuses to
   boot in `NODE_ENV=production` without it.

   ```bash
   openssl rand -hex 32
   ```

   Then paste into `.env`:

   ```dotenv
   BETTER_AUTH_SECRET=<paste-the-64-char-hex-here>
   BETTER_AUTH_URL=http://localhost:53000
   ```

   Dev skips `AUTH_COOKIE_DOMAIN`: host-only cookies are correct for the
   localhost development setup.

3. Keep `CORS_ORIGIN` and `API_GLOBAL_PREFIX=api` as `.env.example` sets
   them. The admin dev server proxies `/api` to the backend unchanged and
   forwards the browser's `Origin: http://localhost:53200` header, so the
   API needs the `api` prefix and its CORS allowlist must include that
   origin. The default lists the admin and storefront dev and e2e origins
   (53200, 53211, 53300, 53311).

### 4. Prepare the database

```bash
npm run prisma:generate            # (re)generate the client
npm run db:push                    # apply schema to the dev DB
npm run db:seed                    # roles, users, catalog, storefront fixtures
```

The seed creates four admin accounts, all with the password `Admin123!`.
They are for local development only: never seed a production database
with `SEED_DEV_OK=1`. Use them to log in at
`http://localhost:53200/auth/login`:

- `superadmin@merchants.test`: Super Admin, all permissions.
- `admin@merchants.test`: Admin.
- `manager@merchants.test`: Manager, scoped to catalog and orders.
- `support@merchants.test`: Support.

### 5. Run the backend

```bash
npm run start:dev                  # NestJS watch mode on http://localhost:53000
```

The API serves `/api/v1/*` with Swagger UI at
`http://localhost:53000/api/docs`.

### 6. Run the admin dashboard

In a **second terminal**:

```bash
npx nx serve admin                 # http://localhost:53200
```

The admin app proxies `/api/*` to `http://localhost:53000` via
`apps/admin/proxy.conf.json`, so cookies, CSRF, and `Accept-Language`
headers flow transparently during dev.

### 7. Run the storefront

```bash
npx nx serve storefront            # http://localhost:53300, SSR through the Analog dev server
```

The storefront reads the store's identity, brand, locales and money from
`GET /v1/store/config` on the API, so run the backend first. The production
build is `npx nx build storefront --configuration=production`, and
`npm run test:storefront-ssr-smoke` runs that build against a seeded test
API.

---

## Daily-driver commands

Once the one-off setup above is done, every later session is just:

```bash
npm run docker:up                  # (if containers were stopped)
npm run start:dev                  # terminal 1, backend
npx nx serve admin                 # terminal 2, admin
```

Hot-reload is wired on both sides. `Ctrl-C` either process; re-run to
restart.

---

## Scripts

Backend:

- `npm run start:dev`: NestJS watch mode (port 53000).
- `npm run start:prod`: run the production build.
- `npm run build`: `nx build api`.
- `npm test`: run every unit test across api and libs.
- `npm run test:e2e`: API e2e (`nx e2e api --forceExit`).
- `npm run lint`: `nx run api:lint && nx run common:eslint:lint`.
- `npm run format`: Prettier on `apps/**/*.ts`, `libs/**/*.ts`, `test/**/*.ts`.
- `npm run gate`: the guards, lint and unit tests on what changed, plus the
  script tests. Run it before every pull request.

Admin:

- `npx nx serve admin`: dev server (port 53200, Angular + HMR).
- `npm run build:admin`: production build + bundle-budget enforcement.
- `npx nx test admin`: Jest unit tests.
- `npx nx test admin-services`: admin service unit tests.
- `npx nx e2e admin-e2e`: Playwright e2e (viewport matrix).
- `npx nx lint admin`: ESLint on the admin app.
- `npm run lhci`: Lighthouse CI. Linux and macOS only; on Windows rely on
  the CI check.

Database:

- `npm run docker:up`: start PG + Redis.
- `npm run docker:down`: stop containers.
- `npm run db:push`: sync the Prisma schema to the dev DB (non-destructive).
- `npm run db:reset`: drop + re-seed.
- `npm run db:seed`: run `prisma/seed.ts`.
- `npm run prisma:generate`: generate the Prisma client.
- `npm run prisma:migrate`: create + apply a new migration.

Nx:

- `npx nx graph`: open the project graph.
- `npx nx affected -t test`: run tests only on projects touched by the
  current diff.
- `npx nx affected -t build`: same for build.
- `npx nx reset`: clear the Nx cache (rarely needed).

---

## Environment Variables

The backend reads from `.env` (or the process environment) at boot.
[.env.example](.env.example) documents every key for a developer box; a
deployment's `.env.production` is written by the install stepper. The
full list, with defaults, is in
[docs/site/reference/environment-variables.md](docs/site/reference/environment-variables.md).
The essentials:

- `PORT` (default 53000): server port.
- `NODE_ENV` (default `development`): `development`, `test` or `production`.
- `DATABASE_URL` (required): PostgreSQL connection string for dev.
- `DATABASE_TEST_URL` (required for tests): PostgreSQL connection string
  for the test DB.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis connection (defaults
  `localhost` and 56379).
- `REDIS_TEST_HOST`, `REDIS_TEST_PORT`: test Redis (defaults `localhost`
  and 56380).
- `BETTER_AUTH_SECRET` (required): 32-byte hex HMAC signing key for the
  Better Auth session cookies. Generate with `openssl rand -hex 32`.
- `BETTER_AUTH_URL` (required in production): public API base URL that
  Better Auth puts into the links in verification, reset and magic-link
  emails.
- `AUTH_COOKIE_DOMAIN` (production, optional): leading-dot root domain for
  cross-subdomain session cookies (for example `.example-store.com`).
  Leave it unset on single-host deploys and in dev.
- `CORS_ORIGIN` (required): comma-separated allowed origins. Doubles as
  Better Auth's `trustedOrigins`. The API refuses to boot in
  `NODE_ENV=production` if this is empty.
- `LOG_LEVEL` (default `info`): `debug`, `info`, `warn` or `error`.

Optional integrations (each module reads the relevant group):

- Payments: `STRIPE_API_KEY` + `STRIPE_WEBHOOK_SECRET`.
- Mail: `MAIL_TRANSPORT` (`console` or `resend`), and with `resend` also
  `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`.
- Storage: `STORAGE_DRIVER` (`local` or `s3`), and with `s3` also
  `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY` and `S3_PUBLIC_URL`.
- Bot protection: `TURNSTILE_SECRET`.
- Error reporting: `SENTRY_DSN`. If unset, the Sentry SDK stays off and
  `captureException` does nothing. `SENTRY_TRACES_SAMPLE_RATE` is a float
  from 0 to 1 and defaults to 0.1 in production.

Admin dashboard, if you serve it on a different origin than the API:

- `API_BASE_URL` is baked into the admin build via
  `apps/admin/src/environments/`. Dev uses the proxy; production should
  point at the public API origin.
- `SENTRY_DSN` on the admin side is baked in via the same environment file
  (`environment.sentryDsn`). The SDK does nothing when the value is `null`.

---

## Documentation

- [docs/site/](docs/site/): the public documentation the product site
  renders.
- [docs/site/getting-started/install-on-a-server.md](docs/site/getting-started/install-on-a-server.md):
  installing a store with the setup CLI.
- [docs/site/operate/](docs/site/operate/): operator manual for topology,
  updates, rollback, backups, TLS, logs, license and settings.
- [docs/site/reference/admin-api/](docs/site/reference/admin-api/): the
  REST reference for the admin API, generated from Swagger.
- [docs/site/reference/storefront-api/](docs/site/reference/storefront-api/):
  the REST reference for the storefront API.

---

## Architecture Rules (backend)

**Modular monolith.** Each feature module under `apps/api/src/modules/` is
self-contained (controller + service + repository + DTOs + validation). No
cross-module Prisma access: modules talk to each other through service
interfaces.

**Response envelope.**

```json
{
  "data": { /* payload */ },
  "meta": { "page": 1, "pageSize": 20, "total": 100 }
}
```

**Error envelope.**

```json
{
  "error": { "code": "ERROR_CODE", "message": "Human readable" }
}
```

**Translatable fields.** Every user-facing string is a JSONB object with a
required `default` key plus arbitrary locale keys:

```ts
{ default: "English text", en: "English text", ar: "نص عربي" }
```

A global interceptor resolves locale for the storefront (via
`Accept-Language`) and returns the raw object for admin requests (via
`X-Resolve-Locale: false`).

**Admin auth.** Better Auth opaque cookie sessions. One signed `HttpOnly` +
`Secure` cookie (`better-auth.session_token`, `Path=/`, `SameSite=Lax`)
carries the session id; `cookieCache.maxAge` is at most 5 minutes. No
JavaScript-readable access token; no refresh-token rotation.
`@Permissions('module:action')` on every admin endpoint.

**Customer auth.** Same Better Auth session, plus `@OwnerGuard()` on every
endpoint that references a user-owned entity.

**Soft deletes.** Prisma middleware filters `WHERE deletedAt IS NULL`
everywhere. Never hard-delete user-facing records.

---

## Architecture Rules (admin)

- Angular **21** standalone components, signals, Reactive Forms.
- `@angular/cdk` for headless primitives (Dialog, Overlay, A11y, Listbox).
- Tailwind 3.4 with PostCSS; brand tokens in `styles.css`, filled at
  runtime from the store's brand settings.
- **Zod** schemas at every API boundary. Never trust the backend shape
  blindly.
- TanStack Query only for cached server state. Local UI state stays in
  signals; no NgRx.
- Jest-axe runs in every component test; Playwright axe in every e2e.

---

## Testing

- Backend unit: Jest + `jest-mock-extended`, at least 80% per module.
- Backend e2e: Jest + Supertest, every endpoint.
- Admin unit: Jest + jest-axe, at least 90% of service branches and 95% of
  UI branches.
- Admin e2e: Playwright + axe-playwright, every route on desktop and
  mobile viewports.

---

## Changelog + Releases

[CHANGELOG.md](CHANGELOG.md) is written by hand or from changesets
([@changesets/cli](https://github.com/changesets/changesets)):

```bash
npm run changeset                  # author a changeset for your change
npm run changeset:status           # preview what the next release will bundle
npm run changeset:version          # consume changesets: bump version + CHANGELOG
```

Cutting a release:

```bash
npm run release -- --dry-run       # the checks, nothing written
npm run release                    # build the stepper, write the tarball, tag
git push origin v<version>
```

The script archives `HEAD` plus the built stepper bundle into
`dist/release/themerchantengine-v<version>.tar.gz` and tags `v<version>`.
It refuses a dirty tree, a version with no `## <version>` section in
`CHANGELOG.md`, and a tag that already exists; it never picks the version.
Bump `package.json`, title the changelog section, commit, then run it.
Attach the tarball to the release on the repository host.

---

## CI

`.github/workflows/ci.yml` runs on every push and pull request, one job
per gate:

- `lint`, `unit` and `verify-no-client-refs`.
- `secret-scan`: gitleaks, with a canary that proves it can fail.
- `setup-standalone` and `nginx-templates`.
- `build`: api, admin with its budget and Lighthouse, storefront.
- `backend-e2e`, `admin-e2e` and `storefront-e2e`.
- `ssr-smoke`: the production Nitro build against a seeded test API.
- `install-smoke`: runs `./setup.sh` for real under the local profile on
  the runner's Docker, probes the installed store, and runs the installer
  a second time to prove it is idempotent.

The e2e jobs start Postgres and Redis from this repository's
`docker-compose.yml`, so every harness runs in CI as it runs locally.
Nothing in CI deploys: an operator installs and updates a store with
`./setup.sh`.

---

## Troubleshooting

**`nx serve admin` can't reach the API.** Check the proxy config at
`apps/admin/proxy.conf.json` and make sure the backend is actually
listening on 53000.

**Backend crashes on boot with `BETTER_AUTH_SECRET is missing`.** You
skipped step 3 of setup. Generate the 32-byte hex secret with
`openssl rand -hex 32` and paste it into `.env`.

**Admin login returns `401 Unauthorized`.** You skipped `npm run db:seed`,
so the dev DB has no users. Re-seed and try `superadmin@merchants.test` /
`Admin123!`.

**Admin login returns `500 Internal Server Error` and backend logs
`CORS policy: origin 'http://localhost:53200' not allowed`.** Your
`.env` has a `CORS_ORIGIN` that leaves out `http://localhost:53200`.
Restore the default from `.env.example` and restart the API.

**Every admin call answers `404`.** Your `.env` lacks
`API_GLOBAL_PREFIX=api`. Restore it from `.env.example` and restart the API.

**Windows + Node 22 `npm run lhci` fails with ENOENT.** Known `@lhci/cli`
bug on the flags-cleanup path. Rely on the CI status check or run from
a Linux or macOS environment.

**Prisma client is stale.** Run `npm run prisma:generate`. Schema edits
always need an explicit regenerate.

**Test DB is wedged.** `docker-compose down -v && npm run docker:up`.
The `-v` flag wipes the named volume so PG starts from a clean state.

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request, and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how we work together. Report
security problems privately as [SECURITY.md](SECURITY.md) explains, never
in a public issue.

---

## License

themerchantengine is licensed under the PolyForm Noncommercial License 1.0.0.
See [LICENSE](LICENSE) for the terms and [NOTICE](NOTICE) for the required
notice.

Commercial use, which includes running any store that accepts money from
customers, requires a commercial license.
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) describes the tiers, what
counts as a paid store, renewal and the offline signed license file the
engine verifies at install and at boot. To buy one, or to request the free
thirty-day evaluation license for a noncommercial store in production,
write to Badii Studio at badii@badii.studio.
