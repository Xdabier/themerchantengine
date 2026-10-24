---
title: Seed a model
description: "The three seed paths in prisma/seed.ts, what each one plants, how SEED_SCOPE keeps demo data off a production database, where the installer runs them, and how to add rows for a new model to the right one."
primaryQuery: prisma seed script production safe demo data ecommerce
updated: 2026-09-09
schema: HowTo
---

## When you need this

You added a model, and a fresh database needs rows in it: a default row the API expects at boot, a demo row the local install should show, or fixture rows the e2e suites assert on. Those are three different seeds with three different guards, and the first question is which one your row belongs to. At the end you have rows that land where they should, survive an operator's edits on the next update, and never appear on a production database by accident.

## Files you touch

- `prisma/seed.ts`: the single entry point `prisma db seed` runs (declared in `prisma.config.ts`). It holds the production-safe branch, the destructive demo seed and the opt-in fixture catalogue call.
- `prisma/seeds/store-config/payment-methods.ts` and `prisma/seeds/store-config/index.ts`: the seeds that run on every path, including production. The worked example for a create-only default row.
- `prisma/seeds/fixture-catalogue/gift-cards.ts` and `prisma/seeds/fixture-catalogue/index.ts`: the fixture catalogue the e2e suites and the local demo install use. The worked example for a scoped fixture row.
- `prisma/seeds/fixture-catalogue/lib/idempotency.ts`: the markers the fixture seed clears on re-run, and the append-only models it may never touch.
- `tools/setup/src/runner/install.ts`: the installer's seed step, which decides which of the three paths a box runs.

## The pattern

### 1. Pick the path

`prisma/seed.ts` reads the store config first, from one of four sources in this order: a scenario fixture named by `STORE_CONFIG_FIXTURE`, the `STORE_CONFIG_FILE` the installer writes, the `StoreSetting` rows of a store that has been configured, or, on an empty database with none of those, a neutral built-in config (the seed prints `Store config: neutral (empty database)`, which is what a fresh developer box gets). Then it branches:

- `SEED_SCOPE=notifications-rbac` is the production-safe path. It syncs permissions onto the roles that already exist, upserts the notification templates, seeds the domestic shipping zone, the tax zones, the guest-checkout flag and the cash-on-delivery payment method from the runtime config, flushes the money cache, and returns. No products, no users. The cache flush goes to the Redis that `REDIS_HOST` and `REDIS_PORT` name (`localhost:56379` when unset), whatever database the seed itself wrote to.
- Everything after that return is the destructive demo seed: four roles, seven users with passwords that are in this repository, ten products, four orders, three reviews, one gift card, and a cleanup that hard-deletes every order, review, user and gift card it did not plant. It runs unasked only on `merchants_engine_test`; any other database name needs `SEED_DEV_OK=1`, including the local `merchants_engine_dev` from `.env.example`.
- `FIXTURE_CATALOGUE_SEED=1`, inside the demo path, also runs `seedFixtureCatalogue` from `prisma/seeds/fixture-catalogue/index.ts`: categories, about thirty-six products with `fx-` slugs and processed images, stock levels, reviewers, reviews, questions, promotions, one gift card, one customer at `@fixture.test` and one delivered order, all priced in the currency the store config holds.
- `STORE_CONFIG_FIXTURE=<id>` runs the whole seed under one of the scenario configs in `test/fixtures/store-configs/` (`demo`, `gulf-rtl`, `maghreb-ltr`). `assertFixtureAllowed` in `prisma/seeds/store-config-fixture.ts` refuses it in production unless forced.

The guard that keeps the demo path off a real store, from `prisma/seed.ts`:

```ts
/** The databases the destructive demo seed runs on without SEED_DEV_OK=1: the test database only. */
const DEMO_SEED_DATABASES = ['merchants_engine_test'];
...
  if (!DEMO_SEED_DATABASES.includes(seedDatabaseName) && process.env.SEED_DEV_OK !== '1') {
    console.error(
      `\nRefusing to seed "${seedDatabaseName || '(no database name)'}". This seed is destructive:\n` +
```

### 2. Know where each path runs

The installer's seed step in `tools/setup/src/runner/install.ts` runs the production-safe path on every install and update:

```ts
      const env: string[] = [
        '-e',
        'SEED_SCOPE=notifications-rbac',
        '-e',
        `STORE_CONFIG_FILE=/app/config/${CLIENT_CONFIG_FILE}`,
        '-e',
        `SEED_SHIPPING_FLAT_RATE=${answers.money?.shippingFlatRate ?? ''}`,
      ];
      ...
      await shell.run(
        'docker',
        [...compose(ctx), 'run', '--rm', ...env, 'api', 'npx', 'prisma', 'db', 'seed'],
        { cwd: root },
      );
      if (answers.demoCatalogue && (await isFreshStore(ctx))) {
```

When the demo catalogue was answered yes and the store has no user row yet, the same step runs a second `prisma db seed` with `SEED_DEV_OK=1` and `FIXTURE_CATALOGUE_SEED=1`. On a server profile it then runs `scrambleSeededAccountsSql()`, which deletes the credential rows and soft-deletes every account matching `%@merchants.test`, `%@fixture.test` and `customer%@test.com`. The backend e2e harness in `test/e2e-global-setup.ts` runs `npx ts-node prisma/seed.ts` against the test database under `STORE_CONFIG_FIXTURE=demo`; the storefront suite goes through `scripts/seed-storefront-test.ts`. The manual commands are in `package.json`:

```bash
npm run db:seed
npm run db:seed:fixture-catalogue
npm run db:seed:fixture-catalogue:test
```

On a developer box the first one needs `SEED_DEV_OK=1` in the environment or it refuses and exits 1.

### 3. A default row every store needs: create-only, on the shared path

`prisma/seeds/store-config/payment-methods.ts`:

```ts
export async function seedPaymentMethods(
  prisma: PrismaClient,
): Promise<{ code: string; created: boolean }> {
  const existing = await prisma.paymentMethod.findUnique({
    where: { code: COD_PAYMENT_METHOD_CODE },
    select: { id: true },
  });
  if (existing) return { code: COD_PAYMENT_METHOD_CODE, created: false };

  await prisma.paymentMethod.create({
    data: {
      code: COD_PAYMENT_METHOD_CODE,
      name: COD_NAME,
      description: COD_DESCRIPTION,
      provider: 'cod',
      isActive: true,
      isTestMode: false,
      sortOrder: 0,
      config: {},
    },
  });
  return { code: COD_PAYMENT_METHOD_CODE, created: true };
}
```

Find-then-create, so an operator who disables or renames the row is not overridden on the next update. Export the function from `prisma/seeds/store-config/index.ts`, add it to the import block near the top of `prisma/seed.ts` (the one that already imports `seedPaymentMethods` from `./seeds/store-config`), and call it at both places that call `seedPaymentMethods`: inside the `SEED_SCOPE=notifications-rbac` branch, right after that call and before the money-cache flush, and again in the demo path, where the call sits just before `seedTax`. The spec in `prisma/seeds/store-config/__tests__/seeds.spec.ts` proves each shared seed create-only by hand, one function at a time; a new seed gets no proof until you add its case there. Rows with a secret in them are not seedable; the cash-on-delivery method is seedable because its `config` is empty.

### 4. A fixture row: scoped by a marker, cleared on re-run

`prisma/seeds/fixture-catalogue/gift-cards.ts`:

```ts
export async function seedGiftCards(
  prisma: PrismaClient,
  currency: string,
): Promise<{ giftCards: number }> {
  await prisma.giftCard.create({
    data: {
      code: `${FIXTURE_CATALOGUE_PREFIXES.giftCardCode}WELCOME100`,
      initialBalance: 100,
      currentBalance: 100,
      currency,
      personalMessage: t(
        'A small welcome from Northwind.',
        'Un petit cadeau de bienvenue de Northwind.',
      ) satisfies Prisma.InputJsonValue,
      isActive: true,
    },
  });
  return { giftCards: 1 };
}
```

A plain `create` is enough because `seedFixtureCatalogue` starts with `clearFixtureCatalogueScope`, which deletes every row carrying a marker from `FIXTURE_CATALOGUE_PREFIXES` (`fx-` slugs, `FXGIFT` codes, `@fixture.test` emails, the `FIXTURE-MAIN-WH` location). For a new model: add its marker to `FIXTURE_CATALOGUE_PREFIXES`, add its `deleteMany` to `clearFixtureCatalogueScope` in the right foreign-key order, write a `seed<Model>` file, and call it from `seedFixtureCatalogue` in `prisma/seeds/fixture-catalogue/index.ts` after the rows it depends on. Text goes through `t()` from `prisma/seeds/fixture-catalogue/lib/translatable.ts`, and money comes from the `currency` argument, never a literal.

### 5. A demo row: upsert with an empty update

The demo path in `prisma/seed.ts` upserts on a stable key with `update: {}`, and its cleanup block excludes what it planted:

```ts
  await prisma.giftCard.upsert({
    where: { code: 'GIFTTEST12345678' },
    update: {},
    create: {
      id: 'gc-test-12345678',
      code: 'GIFTTEST12345678',
      initialBalance: 100,
      currentBalance: 100,
      currency: storeConfig.money.currencyCode,
      recipientEmail: 'customer1@test.com',
      recipientName: 'Sam Customer',
      personalMessage: { default: 'Happy Shopping!', en: 'Happy Shopping!', fr: 'Bonne commande.' },
      isActive: true,
    },
  });
```

Place a new demo block before the shipping seed at the end of `main`, which runs last on purpose because it takes the default method back from anything seeded earlier.

## Tests to run

```bash
npm run test:store-config-seed
npm run test:fixture-catalogue-seed
npm run test:notification-defaults
npm run test:setup
npm run test:e2e
```

`test:store-config-seed` runs `prisma/seeds/store-config/__tests__/`, which proves the shared seeds are create-only or carry a real update payload, and that the demo path is an allow-list of database names. `test:fixture-catalogue-seed` runs the static append-only audit and the idempotency spec over every file under `prisma/seeds/fixture-catalogue/`. `test:notification-defaults` runs `prisma/__tests__/`, including the rule that nothing under `prisma/` value-imports outside `libs/shared/common/src`. `test:setup` runs `tools/setup/src/runner/install.spec.ts`, which proves the demo seed runs on a first install only and that every seeded address family is scrambled on a server. `test:e2e` seeds the dockerized test database for real.

## Gotchas

- The seed runs inside the slim production image, which ships `prisma/`, the generated client and `libs/shared/common/src` only. A value import from `apps/api/src` resolves on your box and dies with `MODULE_NOT_FOUND` on the first update; `prisma/__tests__/seed-imports.spec.ts` fails first. Type-only imports may point anywhere.
- Never `upsert`, `update` or `delete` an append-only model from a seed. `prisma/seeds/fixture-catalogue/__tests__/append-only-static.spec.ts` scans the seed sources for `prisma.order.upsert` and its siblings; the seeded delivered order in `prisma/seeds/fixture-catalogue/orders.ts` is a find-then-create with a stable order number for that reason.
- `update: {}` means a re-seed never repairs an existing row. A row seeded wrong once stays wrong; the fix is a backfill script under `prisma/`, like `prisma/backfill-notification-bodies.ts`.
- The demo seed's order numbers share a namespace with the ones the API issues. The seed reserves `order_seq_<year>` through the count it wrote; `prisma/__tests__/seed-order-numbers.spec.ts` keeps the format aligned with `OrdersService`.
- A new throwaway account email has to match a pattern in `SEEDED_ACCOUNT_PATTERNS` in `tools/setup/src/runner/install.ts`, or a server install with the demo catalogue leaves it signed-in-able; the install spec derives the addresses from the seed sources and fails otherwise.
- Seeds that write tax zones or shipping rates call `flushMoneyCache()` after the writes. A zone written directly is invisible to the API for up to an hour without it.
- The production-safe path does not create roles on an empty database; `syncRolePermissions` skips a role that is absent. `prisma/seed-roles-only.ts` creates the four roles with their grants and nothing else.
