---
title: Search after schema changes
description: "Why a bare prisma db push drops the product search column and leaves its trigger behind, what breaks, how the API refuses to boot on a broken dev database, the one repair command, and what the search index actually covers."
primaryQuery: prisma db push drops postgres tsvector column trigger repair
updated: 2026-09-09
schema: HowTo
---

## When you need this

You pushed a schema change and product search returns nothing, or every product create and edit fails with a 500, or the API refuses to start with a message that names `product_search_vector_trig`. The product search index is not in `prisma/schema.prisma`; it lives in a SQL file that has to be re-applied after every push, and the engine has guards for the case where it was not. At the end you know why the half-state happens, how to recognise it, how to repair it in one command on dev and test, and how the installer keeps production out of it.

## Files you touch

- `prisma/search_fts_setup.sql`: the column, the trigger function, the trigger, the indexes and the backfill. The only file you edit when search should cover something new.
- `prisma/apply-fts-setup.ts`: the applier behind `npm run db:fts`, used on dev, test and the e2e harnesses.
- `apps/api/src/bootstrap/fts-integrity.ts`: the boot check, called from `apps/api/src/main.ts`.
- `package.json`: `db:push`, `db:push:raw`, `db:fts` and `db:setup`.
- `tools/setup/src/runner/install.ts`: the schema step that applies the SQL as the superuser on an installed box.
- `apps/api/src/modules/search/search.service.ts`: the query-time half, where brand, category and reference codes are matched.

## The pattern

### 1. Know what lives outside the schema

`prisma/search_fts_setup.sql` adds the column itself:

```sql
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector;
```

and attaches the trigger that keeps it current:

```sql
DROP TRIGGER IF EXISTS product_search_vector_trig ON "Product";
CREATE TRIGGER product_search_vector_trig
  BEFORE INSERT OR UPDATE OF name, description, "shortDescription", tags
  ON "Product"
  FOR EACH ROW
  EXECUTE FUNCTION product_search_vector_update();
```

Prisma knows nothing about either. `prisma db push` diffs the database against `prisma/schema.prisma`, sees a column the schema does not declare, and drops it. When the table holds rows the push stops to ask, which is why every scripted push in this repository carries `--accept-data-loss`; when the table is empty it drops the column with no prompt and no message and reports the database in sync, so a fresh box loses search without a word. The trigger survives, because it fires on `name`, `description`, `shortDescription` and `tags`, none of which were dropped, and a PL/pgSQL body is late-bound so Postgres tracks no dependency on the column it assigns. The comment above `syncSchema()` in `test/e2e-global-setup.ts` records the mechanism.

### 2. Recognise the symptom

From then on the trigger body assigns to a column that is gone. Search returns nothing, and every `INSERT` on `Product` and every `UPDATE` of one of the four columns fails with `record "new" has no field "searchVector"`, which the API surfaces as a 500 on product create and on every text edit. The database looks healthy; only the writes fail.

### 3. The boot check names the repair

`apps/api/src/bootstrap/fts-integrity.ts` reads two rows of `information_schema` at startup and decides:

```ts
export function evaluateFtsIntegrity(probe: FtsProbe): FtsVerdict {
  if (probe.hasTrigger && !probe.hasColumn) {
    return {
      ok: false,
      message:
        `[fts-integrity] BROKEN full-text search state: the trigger "${FTS_TRIGGER_NAME}" is attached ` +
        `to "Product" but the column "${FTS_COLUMN_NAME}" is missing. A bare \`prisma db push\` drops ` +
        `the column and leaves the trigger, which makes search return nothing and every product create ` +
        `or text edit fail with a 500.\n` +
        `[fts-integrity] Repair: ${FTS_REPAIR_COMMAND}`,
    };
  }
  if (probe.hasColumn && !probe.hasTrigger) {
    return {
      ok: true,
      message:
        `[fts-integrity] warning: the column "${FTS_COLUMN_NAME}" exists but the trigger ` +
        `"${FTS_TRIGGER_NAME}" is not attached, so search vectors go stale on every write. ` +
        `Repair: ${FTS_REPAIR_COMMAND}`,
    };
  }
  return { ok: true };
}
```

Four states: trigger and column is healthy; neither is a fresh database before `db:setup` and boots normally; trigger without column throws, so the API refuses to boot; column without trigger only warns. `ftsCheckApplies` skips the check when `NODE_ENV` reads as production, and `runtimeEnvironment` in `libs/shared/common/src/env/runtime-environment.ts` reads anything other than exactly `development` or `test` as production. A probe that fails for another reason, such as no database yet, is swallowed, so the check never becomes the cause of an unrelated boot failure.

### 4. Repair

```bash
npm run db:fts
```

That is `ts-node prisma/apply-fts-setup.ts`: it connects to `DATABASE_URL` with the `pg` client and runs the whole SQL file as one batch, which Postgres wraps in one implicit transaction. The file is idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`), ends with `UPDATE "Product" SET name = name WHERE "deletedAt" IS NULL` to fire the trigger for every live row, and then raises if any active product still has a `NULL` vector. Because it is idempotent, running it is also the quickest check that does not need the API: it prints the repair it did or confirms the state. To look without touching, ask Postgres directly:

```bash
docker exec merchants-engine-postgres-dev psql -U postgres -d merchants_engine_dev -tAc \
  "select count(*) from information_schema.columns where table_name = 'Product' and column_name = 'searchVector'"
```

`1` is healthy, `0` is the state this page is about.

To avoid the state in the first place, push through the chained script in `package.json`:

```json
"db:push:raw": "prisma db push",
"db:push": "npm run db:push:raw && npm run db:fts && npm run db:order-status-history",
"db:fts": "ts-node prisma/apply-fts-setup.ts",
"db:setup": "npm run db:push:raw -- --accept-data-loss && npm run db:fts && npm run db:notification-indexes && npm run db:order-status-history && npm run prisma:generate",
```

On an installed box the API connects as `merchants_app`, which can neither `CREATE EXTENSION` nor replace a function owned by `postgres` (error 42501), so `db:fts` is the wrong tool there. The installer's schema step in `tools/setup/src/runner/install.ts` pushes and then pipes the same file through the database container as the superuser:

```ts
      const fts = shell.readFile(path.join(root, 'prisma', 'search_fts_setup.sql'));
      await shell.run(
        'docker',
        [
          'exec',
          '-i',
          layout.containers.postgres,
          'psql',
          '-U',
          'postgres',
          '-d',
          'merchants_engine',
          '-v',
          'ON_ERROR_STOP=1',
          '-f',
          '-',
        ],
        { input: fts },
      );
```

The by-hand equivalent is on [Update](../../../operate/update.md). A restored dump carries the column, the trigger and the indexes, so a restore needs no re-apply, see [Backups and restore](../../../operate/backups-and-restore.md).

### 5. The trigger is NULL-safe, and that is not optional

`tsvector` concatenation yields `NULL` when any operand is `NULL`, and a `NULL` vector never matches, so a product with no tags used to vanish from search. Every operand in `product_search_vector_update()` is guarded:

```sql
    setweight(
      to_tsvector('simple',
        unaccent(array_to_string(COALESCE(NEW.tags, ARRAY[]::text[]), ' '))
      ), 'C'
    ) ||
```

and the whole expression is wrapped in `COALESCE(..., ''::tsvector)`. Keep that shape when you add a segment, or the terminal guard in the file will raise on the first product that lacks the new field.

### 6. What search covers

The trigger weights, from `prisma/search_fts_setup.sql`: product name at A (the `default` key and one key per registry language of the Translatable), short description at B, tags at C, the first 10,000 characters of the description at D. Brand and category names are not in the vector; `search.service.ts` resolves them at query time through `resolveBrandMatches` and `resolveCategoryMatches` and feeds the ids into the FTS query as extra `OR` clauses, backed by the trigram indexes on `Brand.name` and `Category.name` the same SQL file creates. Variant SKU, MPN and GTIN are matched exact or by prefix on `LOWER(...)`, never fuzzily, through the `text_pattern_ops` indexes in section 6b of the file. A new searchable product field goes into the trigger function with a weight, into the `UPDATE OF` column list of the trigger, and, if it is on another table, into the query-time resolvers instead.

## Tests to run

```bash
npx nx test api
npm run test:e2e
npx nx e2e storefront-e2e --grep=search
```

`npx nx test api` runs `apps/api/src/bootstrap/fts-integrity.spec.ts`, which pins all four states, the production exclusion and the exact trigger and column names the probe reads, plus `apps/api/src/modules/search/search.service.spec.ts`. `npm run test:e2e` pushes the schema, calls `applyFtsSetup` before the seed, and runs the search suites against the real index. The storefront suite seeds the fixture catalogue and drives the search page in a browser; `--grep=` is how this workspace selects specs.

## Gotchas

- `npm run db:push -- --accept-data-loss` puts the flag on the last command in the chain, which is not Prisma. `db:setup` exists because it passes the flag to `db:push:raw` itself.
- On production `psql` auto-commits per statement, so the terminal `RAISE` fails the job without rolling back the backfill; run it with `-v ON_ERROR_STOP=1` as the installer does, or the exit code is zero on a failed apply.
- The file is generated from the language registry by `prisma/fts-setup-sql.ts`; do not edit it by hand. Each registry language gets a `to_tsvector` segment with its `textSearchConfig` and its own trigram indexes, and the `DROP INDEX` statements are unconditional. A new language is a registry entry, then `npm run db:fts:generate` and `npm run db:push`.
- `prisma/apply-fts-setup.ts` runs the file as one transaction, so every index drop, index build and the backfill hold their locks on `Product`, `Category` and `Brand` together until it commits. Seconds at catalogue size, but pick the window with that in mind.
- The trigger is bound to four columns. A bulk import that writes rows through a path that bypasses them, or a restore into a database with the column but no trigger, leaves stale vectors and only a warning at boot; `npm run db:fts` rebuilds every live row.
- Two other pieces of SQL share this problem: `prisma/apply-notification-indexes.ts` and `prisma/apply-shipping-indexes.ts` re-install indexes the schema cannot express. `db:setup`, the installer and `test/e2e-global-setup.ts` run all three; a hand-run push runs none.
