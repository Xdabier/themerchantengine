# Migration: add Brand model + Product.gtin/mpn + brand backfill

**Phase:** S24.4 (storefront track)
**Records:** DR-09 (product rich-results) · DR-12 (catalog-ingestion-pipeline boundary)
**Pattern:** Expand → migrate code → contract (`merchants-migration-author` skill)

## What this migration does

1. **Creates the `Brand` table.** Translatable `name` and `description` JSONB columns per §3.2, soft-delete `deletedAt` per §3.4, slug uniqueness, optional `logoAssetId` FK to `Asset` with `ON DELETE SET NULL`, sortOrder + timestamps. GIN index on `name` JSONB to keep locale-resolved name lookups cheap.
2. **Adds `brandId`, `gtin`, `mpn` columns to `Product`.** All nullable. `brandId` is an FK to `Brand` with `ON DELETE SET NULL`. New `Product_brandId_idx` index supports per-brand product listings.
3. **Backfills** the deprecated free-text `Product.brand` column into `Brand` rows + sets `Product.brandId` for every product whose legacy brand string maps cleanly to a new Brand row. The legacy column is retained for one release as a read-only fallback consumed by `buildProductSchema` when `brandId IS NULL`.

## Why the legacy `Product.brand` column is retained

Per the expand → migrate code → contract pattern: the schema change ships first (this migration), the code is updated to read via `brandId` first with the legacy column as a fallback (S24.6), and the S25 contract migration drops the legacy column once every product has been backfilled and every code path has switched.

The slug-normalization collision handling (`ON CONFLICT (slug) DO NOTHING`) intentionally leaves a small subset of products with `brandId IS NULL` whose legacy `brand` string is still load-bearing for JSON-LD emit. Dropping the legacy column before the operator deduplicates those collisions via the S25 admin Brand CRUD UI would lose the brand attribution for those products in JSON-LD.

## Rollback plan

If this migration ships and we need to revert before S25 lands:

1. **Drop the FK + new columns + Brand table.** `Product.brand` legacy column is unchanged — no data loss.

   ```sql
   ALTER TABLE "Product" DROP CONSTRAINT "Product_brandId_fkey";
   ALTER TABLE "Product" DROP COLUMN "brandId";
   ALTER TABLE "Product" DROP COLUMN "gtin";
   ALTER TABLE "Product" DROP COLUMN "mpn";
   DROP INDEX IF EXISTS "Product_brandId_idx";
   DROP TABLE "Brand" CASCADE;
   ```

2. **Revert the schema.prisma change** — remove `Brand` model, remove `brandId`/`gtin`/`mpn` columns from `Product`, revert the `brand` field comment, remove the `Asset.brandLogos` back-relation.

3. **Revert the S24.6 buildProductSchema enrichment** so the JSON-LD emit no longer reads `brand`/`sku`/`gtin`/`mpn`/`itemCondition` fields. Otherwise the runtime errors when reading missing columns.

4. **No data export step needed** — every legacy `Product.brand` string is preserved on the original column. The Brand rows that were backfilled are derivable again on a re-run.

## Code-vs-schema deploy order

Schema **must precede** code per the constitution §3.4 expand-pattern guidance:

1. `npx prisma migrate deploy` — applies this migration against the prod DB.
2. **Verify** the backfill: `SELECT COUNT(*) FROM "Brand";` should equal the distinct non-empty `Product.brand` count modulo slug collisions; `SELECT COUNT(*) FROM "Product" WHERE "brand" IS NOT NULL AND "brandId" IS NULL;` flags collision survivors.
3. Roll the API workers — the new schema is compatible with both the old code (which ignores the new columns) and the new S24.6 code (which reads `brandId` first with the legacy column fallback).
4. Deploy the new code carrying S24.6.
5. The S25 contract migration drops the legacy column once every product has a `brandId` set or has been deduplicated by the operator.

## Concurrent-write safety

Migration runs inside an implicit Prisma transaction. The `CREATE TABLE` + `ALTER TABLE` statements take an `ACCESS EXCLUSIVE` lock on `Product` for their duration; concurrent writes block until the migration completes. Backfill row count is bounded by the catalogue size (well under 10K rows pre-launch); the lock window is sub-second.

For larger catalogs (>100K rows) this approach would need a staged rollout: add the columns nullable first, backfill in batches outside the migration, then add the FK constraint in a follow-up migration. The catalog-ingestion-pipeline track will hit that scale; it will use the staged approach when it lands client #2 or larger.

## Slug-collision edge case

Two distinct legacy brand strings can normalize to the same slug (e.g., `Finch` and `FINCH!` both → `finch`). The migration's `ON CONFLICT (slug) DO NOTHING` keeps the first inserted row and skips the second. The losing product's `Product.brandId` stays `NULL` and the JSON-LD emit falls back to the deprecated free-text column.

The S25 admin Brand CRUD UI lets the operator review and merge collision survivors before the S25 contract migration drops the legacy column. A pre-flight query the operator runs before that contract migration:

```sql
SELECT "brand", COUNT(*) AS product_count
FROM "Product"
WHERE "brand" IS NOT NULL AND "brandId" IS NULL
GROUP BY "brand"
ORDER BY product_count DESC;
```

Each row in the result is a brand string the operator must reconcile (rename, merge into an existing Brand, or accept as new) before the legacy column drops.
