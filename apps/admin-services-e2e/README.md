# admin-services-e2e

Playwright **contract tests** for the Angular admin-services layer against a
real NestJS backend.

These specs don't drive a browser. They use Playwright's `request` fixture to
hit `/v1/*` directly, then pipe every response through the **same Zod schemas**
that the Angular services (`libs/admin-services`) use at runtime. If the
backend drifts from the schema, the Angular client would throw on `.parse()` in
production — these tests catch that drift in CI.

## Prerequisites

1. Postgres + Redis running: `npm run docker:up`
2. Schema + seed applied: `npm run db:reset -- --force`
3. API running on `:53000`: `npm run start:dev`

## Run

```bash
npm run test:services-e2e
# or directly:
npx nx e2e admin-services-e2e
```

Override the backend URL with `API_BASE_URL=https://staging.example.test`.

## Layout

```
src/
  fixtures/
    auth.ts          Authenticated APIRequestContext per role (admin, manager, support, anon)
    test-users.ts    Seeded credentials catalog (mirrors prisma/seed.ts)
  helpers/
    zod-response.ts  expectSchema(response, zodSchema) — prints Zod issue list on failure
  specs/
    auth.spec.ts     /v1/auth/* happy + error envelope
    users.spec.ts    /v1/users/me + /v1/admin/{customers,staff,roles}
```

## Writing a new spec

- Import schemas directly from `@admin-services/<module>/<module>.schemas`
  — NOT from the `@admin-services` barrel, which pulls in Angular HttpClient
  runtime that can't load in a Node-only context.
- Use `expectSchema(response, schema, { status: 200 })` over raw
  `response.ok()` — it validates the full envelope and surfaces Zod issues in
  the test output.
- Reuse the role-scoped contexts (`adminRequest`, `managerRequest`,
  `supportRequest`) to assert RBAC boundaries — support should 403 on any
  `admin_users:*` endpoint, etc.

## Non-goals

- Browser-driven e2e (that's `admin-e2e`).
- Mutating-heavy scenarios that leave the DB dirty. Smoke-and-read is fine;
  large fixtures should reset the DB in `globalSetup` once the suite grows
  (next milestone: add `globalSetup` running `prisma migrate reset --force`).
