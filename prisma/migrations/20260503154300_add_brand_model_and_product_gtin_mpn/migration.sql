-- ============================================================
-- S24.4 — Brand model + Product.gtin/mpn columns + brand backfill
-- Per DR-09 (product rich-results) + DR-12 (catalog-ingestion-pipeline boundary)
--
-- Expand → migrate code → contract pattern (merchants-migration-author skill):
--   - This migration EXPANDS: introduces Brand table + Product.brandId/gtin/mpn
--     columns + backfills the deprecated free-text Product.brand into the new FK.
--     The legacy Product.brand column is RETAINED for one release as a read-only
--     fallback. The S24.6 buildProductSchema enrichment reads brandId first;
--     when NULL, it falls back to the deprecated column.
--   - The S25 contract migration drops the legacy Product.brand column once
--     every product has been backfilled and every code path reads via brandId.
--
-- Backfill safety under concurrent writes:
--   The migration runs inside an implicit Prisma transaction. The CREATE TABLE
--   + ALTER TABLE statements take an ACCESS EXCLUSIVE lock on Product for their
--   duration; concurrent writes block until the migration completes. This is
--   the same lock-class used by every prior schema-changing migration in this
--   project. Backfill row count is bounded by the catalogue size
--   (well under 10K rows pre-launch).
--
-- Slug-collision handling:
--   ON CONFLICT (slug) DO NOTHING covers the case where two distinct legacy
--   brand strings normalize to the same slug. The losing string keeps the
--   deprecated column value and Product.brandId stays NULL; the
--   buildProductSchema fallback handles that path. The S25 admin Brand CRUD
--   UI lets the operator dedupe manually before the contract migration drops
--   the legacy column.
-- ============================================================

-- ============================================================
-- (a) CREATE TABLE Brand
-- ============================================================

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
CREATE INDEX "Brand_slug_idx" ON "Brand"("slug");
CREATE INDEX "Brand_deletedAt_idx" ON "Brand"("deletedAt");

-- GIN index on Brand.name JSONB to keep locale-resolved name lookups cheap.
CREATE INDEX "Brand_name_gin_idx" ON "Brand" USING gin("name");

-- FK to Asset (nullable, ON DELETE SET NULL) — operator-uploaded logo asset.
ALTER TABLE "Brand"
  ADD CONSTRAINT "Brand_logoAssetId_fkey"
  FOREIGN KEY ("logoAssetId") REFERENCES "Asset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- (b) ALTER TABLE Product — add brandId, gtin, mpn columns
-- ============================================================

ALTER TABLE "Product" ADD COLUMN "brandId" TEXT;
ALTER TABLE "Product" ADD COLUMN "gtin"    TEXT;
ALTER TABLE "Product" ADD COLUMN "mpn"     TEXT;

CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- (c) Backfill — distinct legacy brand strings → Brand rows; link Product.brandId
-- ============================================================

-- Insert one Brand row per distinct non-empty legacy free-text brand value.
-- Slug derivation: trim → lower → replace runs of non-alphanumerics with '-'.
-- ON CONFLICT (slug) DO NOTHING handles slug-normalization collisions.
INSERT INTO "Brand" ("id", "name", "slug", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::TEXT,
  jsonb_build_object('default', "brand", 'en', "brand"),
  lower(regexp_replace(trim("brand"), '[^a-zA-Z0-9]+', '-', 'g')),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product"
WHERE "brand" IS NOT NULL AND trim("brand") <> ''
GROUP BY "brand"
ON CONFLICT ("slug") DO NOTHING;

-- Link every Product.brandId to its corresponding Brand row matched on the
-- Translatable JSONB `default` key. Products whose brand string lost the
-- slug-normalization race keep brandId NULL and rely on the deprecated column
-- fallback in buildProductSchema (S24.6).
UPDATE "Product"
SET "brandId" = (
  SELECT b."id"
  FROM "Brand" b
  WHERE b."name"->>'default' = "Product"."brand"
  LIMIT 1
)
WHERE "brand" IS NOT NULL AND trim("brand") <> '';
