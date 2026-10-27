-- Standard shipping, phase 0.
--
-- Adds the persisted "default / preselected standard method" concept and the
-- invoice-side method-name snapshot the rest of the feature depends on:
--
--   1. ShippingMethod.isDefault   — marks a zone's standard method. Mirrors the
--      established TaxZone.isDefault / TaxClass.isDefault pattern. Consumed by
--      ShippingService rate resolution (default first), storefront checkout
--      auto-pick, and the new admin order-create preselection (§4.15).
--   2. Invoice.shippingMethodName — snapshot of the charged shipping method name
--      on the immutable invoice payload. The Invoice row already snapshots
--      shippingAmount but not the name. Invoice is append-only (§9.6): additive
--      NULLABLE column only, no backfill, existing invoices keep NULL.
--
-- A partial-unique index enforces at most ONE default method per zone among live
-- (non-soft-deleted) methods. Partial indexes are not expressible in the Prisma
-- schema, so this statement is hand-authored here; it also serves as the
-- "default method for this zone" lookup. Plain CREATE (transaction-safe under
-- `prisma migrate deploy`, which wraps each migration in a transaction);
-- CREATE INDEX CONCURRENTLY is intentionally avoided.
--
-- Forward-safe: purely additive. No table rewrite (the new boolean carries a
-- constant DEFAULT false, which Postgres adds without rewriting existing rows),
-- no data change. IF NOT EXISTS on every statement makes a re-run a no-op and
-- keeps dev (synced via `prisma db execute`, because `prisma db push` would drop
-- the schema-less Product.searchVector FTS column) and prod (`migrate deploy`)
-- in step.
--
-- Rollback (forward-only — author a new migration to reverse):
--   DROP INDEX IF EXISTS "ShippingMethod_one_default_per_zone";
--   ALTER TABLE "ShippingMethod" DROP COLUMN IF EXISTS "isDefault";
--   ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "shippingMethodName";
-- DROP COLUMN "isDefault" loses only which method was flagged default (re-set via
-- the admin toggle); DROP COLUMN "shippingMethodName" loses invoice method-name
-- snapshots (the amount is retained; Order.shippingMethodName is unaffected).
-- Schema change must ship before the code that reads these columns.

ALTER TABLE "ShippingMethod" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "shippingMethodName" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ShippingMethod_one_default_per_zone"
  ON "ShippingMethod" ("zoneId")
  WHERE "isDefault" AND "deletedAt" IS NULL;
