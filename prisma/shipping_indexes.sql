-- Default shipping method per zone.
--
-- Partial-unique index enforcing at most ONE default shipping method per zone
-- among live (non-soft-deleted) methods. Partial indexes are not expressible in
-- the Prisma schema, and the repo deploys schema with `prisma db push` (never
-- `migrate deploy`), so `db push` never creates this index on prod — it is
-- applied here via the CI migrate-db psql step, immediately after `db push`
-- adds the `isDefault` column. Idempotent (IF NOT EXISTS).
--
-- The service-layer clear-then-set transaction in ShippingService is the primary
-- guard; this index is the DB backstop (§3.4 atomicity). It also serves the
-- per-zone "find the default" lookup.
CREATE UNIQUE INDEX IF NOT EXISTS "ShippingMethod_one_default_per_zone"
  ON "ShippingMethod" ("zoneId")
  WHERE "isDefault" AND "deletedAt" IS NULL;
