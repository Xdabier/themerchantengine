-- DR-17 — admin SEO indexing dashboard + durable submission log
-- (specs/features/seo-indexing-dashboard) — Phase D1.
--
-- Adds one append-only table, SeoSubmission, recording every search-engine
-- submission attempt (manual + auto-regen + cron), ONE ROW PER ENGINE per
-- attempt: who/when/target/engine/requested-submitted-deduped counts/accepted/
-- fail-open reason/correlationId. This is the audit trail that closes the
-- DR-16 silent-failure class (submits were fire-and-forget WARN logs).
--
-- §3.4 / §9.6: SeoSubmission is APPEND-ONLY — same class as AnalyticsEvent /
-- WebhookDelivery / AuditLogEntry. It carries NO `deletedAt` and is intentionally
-- NOT registered in SOFT_DELETE_MODELS (apps/api/src/prisma/prisma.service.ts).
-- `actorId` is a plain string (no FK) so the log survives user deletion.
--
-- Forward-safe: purely additive (one empty table). No backfill, no existing
-- table touched, no data change, no rewrite. IF NOT EXISTS on every statement
-- makes a re-run a no-op and keeps dev (synced via `prisma db execute`, because
-- `prisma db push` would drop the schema-less Product.searchVector FTS column)
-- and prod (`prisma migrate deploy`) in step.
--
-- Rollback (forward-only — author a new migration to reverse):
--   DROP TABLE IF EXISTS "SeoSubmission";
-- Purely additive — dropping the table loses only the submission audit history;
-- no other model references it.

CREATE TABLE IF NOT EXISTS "SeoSubmission" (
  "id"             TEXT NOT NULL,
  "actorId"        TEXT,
  "trigger"        TEXT NOT NULL,
  "targetType"     TEXT NOT NULL,
  "targetRef"      TEXT NOT NULL,
  "engine"         TEXT NOT NULL,
  "requestedCount" INTEGER NOT NULL DEFAULT 0,
  "submittedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedDeduped" INTEGER NOT NULL DEFAULT 0,
  "accepted"       BOOLEAN NOT NULL,
  "reason"         TEXT,
  "correlationId"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SeoSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SeoSubmission_engine_createdAt_idx"
  ON "SeoSubmission" ("engine", "createdAt");

CREATE INDEX IF NOT EXISTS "SeoSubmission_targetType_createdAt_idx"
  ON "SeoSubmission" ("targetType", "createdAt");

CREATE INDEX IF NOT EXISTS "SeoSubmission_createdAt_idx"
  ON "SeoSubmission" ("createdAt");
