---
title: Add a model
description: "Declare a Prisma model with its soft-delete column and foreign keys, register it with the soft-delete filter, write the migration record, apply the schema the way the installer does, and guard any contested counter."
primaryQuery: add a prisma model nestjs ecommerce soft delete migration
updated: 2026-09-09
schema: HowTo
---

## When you need this

You are adding a table the engine does not have: a loyalty tier, a supplier, a size chart. In this codebase a model never lands alone. It carries a `deletedAt` column when its rows can be retired, a declared relation for every reference to another table, a migration file as the written record, and a seed row where a fresh database needs one. This page walks the `Brand` model and the `Carrier` service, which are the smallest real examples of each rule. At the end you have a model the API can query, that the soft-delete filter hides when retired, and that the installer applies on the next update.

## Files you touch

- `prisma/schema.prisma`: the model, its `deletedAt`, its indexes and its relations. The `Brand` model is the worked example.
- `prisma/migrations/20260503154300_add_brand_model_and_product_gtin_mpn/migration.sql`: the migration that introduced `Brand`, as the shape and naming to copy for yours.
- `apps/api/src/prisma/prisma.service.ts`: the `SOFT_DELETE_MODELS` list your model joins, and the filter that reads it.
- `apps/api/src/modules/carriers/carriers.service.ts`: a service whose reads and its `remove` follow the soft-delete rule.
- `apps/api/src/modules/gift-cards/gift-cards.service.ts`: the WHERE-guarded decrement to copy when the model holds a contested number.
- `prisma/seed.ts` or a file under `prisma/seeds/`: the rows a fresh database needs, see [Seed a model](./seed-a-model.md).

## The pattern

### 1. Declare the model with its soft-delete column and its relations

The datasource URL is not in the schema file. `prisma.config.ts` reads `DATABASE_URL` from `.env` and hands it to Prisma 7; `prisma/schema.prisma` only declares the provider.

`prisma/schema.prisma`, the `Brand` model:

```prisma
model Brand {
  id          String    @id @default(cuid())
  /// Translatable: { default, fr, en }
  name        Json
  slug        String    @unique
  description Json?
  logoAssetId String?
  sortOrder   Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  logoAsset Asset?    @relation("BrandLogo", fields: [logoAssetId], references: [id], onDelete: SetNull)
  products  Product[]

  @@index([slug])
  @@index([deletedAt])
}
```

Three rules are visible here. User-facing text is `Json` in the Translatable shape, never a plain string per locale. `deletedAt` is nullable and indexed, so the filter in the next step stays cheap. Every reference to another table is a declared relation with an `onDelete` policy: `Product.brandId` points back through `brandRelation Brand? @relation(fields: [brandId], references: [id], onDelete: SetNull)` in the same file. A `String[]` column is only for value lists, such as the ISO country codes in `Carrier.zones`, never for ids of another table.

Not every model gets `deletedAt`. `Order` is declared in `prisma/schema.prisma` as an immutable record that is never soft-deleted, and the fixture seed's `APPEND_ONLY_MODELS` list in `prisma/seeds/fixture-catalogue/lib/idempotency.ts` names the whole set by Prisma delegate name: `order`, `orderItem`, `inventoryMovement`, `giftCardTransaction`, `promotionUsage`, `auditLogEntry`, `return`, `returnItem`, `invoice`. Those rows are history; leave the column off, and never let a seed write to one of them (a spec beside the list asserts it).

### 2. Register the model with the soft-delete filter

The filter is a Prisma client extension, not a middleware, and it only knows the models in one list.

`apps/api/src/prisma/prisma.service.ts`:

```ts
export const SOFT_DELETE_MODELS = [
  'User',
  'Product',
  'ProductVariant',
  'Category',
  // ... seventeen more, Brand and Carrier among them
  'Campaign',
  'CampaignSend',
] as const;

export function applySoftDeleteFilter(
  model: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!SOFT_DELETE_MODELS.includes(model as SoftDeleteModel)) return args;

  const where = (args.where ?? {}) as Record<string, unknown>;

  // Bypass: caller already specified a deletedAt condition
  if ('deletedAt' in where) return args;

  return { ...args, where: { ...where, deletedAt: null } };
}
```

The extension applies that function to `findMany`, `findFirst`, `findUnique` and `count`, and nothing else. A read that names `deletedAt` itself, for example `{ deletedAt: { not: null } }` on an admin recovery screen, is passed through untouched. Add your model name to the list, and the unit test in `apps/api/src/prisma/prisma.service.spec.ts` that checks the list's contents needs the same edit.

A delete is an update. `apps/api/src/modules/carriers/carriers.service.ts`:

```ts
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.carrier.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Carrier "${id}" not found`);

    await this.prisma.carrier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
```

`update`, `updateMany`, `delete` and `deleteMany` are not filtered, so a write path checks `deletedAt: null` itself, as `findFirst` does above.

### 3. Write the migration record by hand

Do not run `npx prisma migrate dev` here. The folders under `prisma/migrations/` do not start from an empty database: the oldest one, `prisma/migrations/20260503154300_add_brand_model_and_product_gtin_mpn/migration.sql`, alters `Product` and references `Asset`, and no folder creates either table. `migrate dev` replays the chain on a shadow database, fails with `P3006` on that first folder, and writes nothing. The schema is applied by `prisma db push` everywhere (next paragraph), and the migration folder is the written record of the change.

Create `prisma/migrations/<UTC timestamp>_<snake_case_name>/migration.sql` yourself; the existing folder names show the timestamp form. The SQL for a soft-deletable table with a foreign key, from that same Brand folder:

```sql
CREATE TABLE "Brand" (
  "id"          TEXT        NOT NULL,
  "name"        JSONB       NOT NULL,
  "slug"        TEXT        NOT NULL,
  "description" JSONB,
  "logoAssetId" TEXT,
  "sortOrder"   INTEGER     NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),

  CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");
CREATE INDEX "Brand_deletedAt_idx" ON "Brand"("deletedAt");

ALTER TABLE "Brand"
  ADD CONSTRAINT "Brand_logoAssetId_fkey"
  FOREIGN KEY ("logoAssetId") REFERENCES "Asset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

Know what applies the schema where. On a developer box it is `npm run db:push`, which `package.json` chains as `prisma db push`, then `npm run db:fts`, then the order-history backfill. The installer's schema step in `tools/setup/src/runner/install.ts` runs `npx prisma db push --accept-data-loss` inside the API container, then pipes `prisma/search_fts_setup.sql` through the Postgres container as the superuser, then the two index scripts. The backend e2e harness in `test/e2e-global-setup.ts` does the same push before it seeds. The GitHub workflow in `.github/workflows/ci.yml` never runs `migrate deploy`; its `install-smoke` job runs `./setup.sh --profile local`, which is the installer. So the migration file is the written record and the lane for a `migrate` deployment, and a backfill written only in its SQL never runs on a pushed database: `prisma/migrations/20260830130000_order_status_history/migration.sql` says so in its header, and its executable twin is `prisma/backfill-order-status-history.ts`, wired into `db:push` and `db:setup`.

Then run `npm run prisma:generate` so the API compiles against the new model.

### 4. Guard a contested number with a WHERE clause

When the model holds a balance or a count that two requests can decrement at once, never read and then write. `apps/api/src/modules/gift-cards/gift-cards.service.ts`:

```ts
    const result = await this.prisma.giftCard.updateMany({
      where: {
        id: card.id,
        isActive: true,
        deletedAt: null,
        currentBalance: { gte: amount },
      },
      data: { currentBalance: { decrement: amount } },
    });

    if (result.count === 0) {
      throw new GiftCardInsufficientBalanceException('Insufficient gift card balance');
    }
```

Zero affected rows is the contention signal. `apps/api/src/modules/inventory/inventory.service.ts` does the same for `StockLevel.onHand` with `$executeRaw` statements of the shape `UPDATE "StockLevel" SET "onHand" = "onHand" - qty WHERE ... AND "onHand" >= qty` (the decrement, the matching increment inside a transaction, and the release), and those are the only raw writes in that module; a new one needs a review, not a copy.

### 5. Human-facing numbers come from a Postgres sequence

Order and invoice numbers are not application counters. `apps/api/src/modules/orders/orders.service.ts`:

```ts
  private async nextSequenceValue(name: string): Promise<number> {
    const year = new Date().getFullYear();
    const seqName = `${name}_seq_${year}`;
    await (this.prisma as any).$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS "${seqName}" START WITH 1 INCREMENT BY 1`,
    );
    const result: { value: bigint }[] = await (this.prisma as any).$queryRawUnsafe(
      `SELECT nextval('"${seqName}"') AS value`,
    );
    return Number(result[0].value);
  }
```

The sequence is created on first use, one per name and year, so no migration declares it. The `SequenceCounter` model in `prisma/schema.prisma` is a separate table the demo seed writes; it is not what numbers an order. A new numbered document copies `nextSequenceValue` with its own prefix.

## Tests to run

```bash
npx nx test api
npx nx lint api
npm run test:e2e
```

`npx nx test api` runs `apps/api/src/prisma/prisma.service.spec.ts`, which pins the soft-delete list and the filter, and your module's spec. `npx nx lint api` catches a type or import error in the new service before the e2e run does. `npm run test:e2e` pushes `prisma/schema.prisma` onto the dockerized test database, re-applies the search SQL, seeds, and runs every Supertest suite against the real schema; it needs `npm run docker:up` first.

## Gotchas

- A bare `npx prisma db push` drops the product search column and leaves its trigger behind, and the API then refuses to boot on dev. Use `npm run db:push`, or run `npm run db:fts` after the push. Details in [Search after schema changes](./search-after-schema-changes.md).
- `--accept-data-loss` is what lets a push through when the search column holds data. `db:setup` in `package.json` and the installer both pass it, because the column lives outside `prisma/schema.prisma`. On a table with no rows the flag changes nothing: a bare push drops the column with no prompt and no message, and reports the database in sync.
- A partial unique index cannot be declared in the schema, so `db push` never creates it. `prisma/shipping_indexes.sql` enforces one default shipping method per zone among live rows, and `prisma/apply-shipping-indexes.ts` re-installs it after every push. A unique rule that must ignore soft-deleted rows needs the same treatment.
- Migrations are forward-only. There is no schema rollback in the installer or in `deploy/scripts/rollback.sh`; the dump you took before the update is the rollback, see [Rollback](../../../operate/rollback.md) and [Backups and restore](../../../operate/backups-and-restore.md).
- The filter covers reads and `count` only. An `update` or `delete` that forgets `deletedAt: null` in its `where` will happily revive or alter a retired row.
- A `NOT NULL` column added to a table with rows needs a default or a backfill, and under `db push` the backfill has to be a script under `prisma/`, not SQL in the migration folder.
- The seed is part of the change. A model the API needs at boot, or that a fresh install must show, gets its rows in the right seed path; a demo-only row must never land on the production path. See [Seed a model](./seed-a-model.md).
