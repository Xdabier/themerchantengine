-- NE7 — customer preference center + consent + unsubscribe (notifications-email-engine).
--
-- 1. New NotificationPreference table — per-user/per-category communication
--    consent. The MailService.enqueue gate consults it for non-transactional
--    flows only; an absent row means NOT consented (opt-in required, per the
--    NE7 spec), so a LIFECYCLE/MARKETING flow is skipped until the customer
--    opts in via the storefront preference center.
-- 2. Soft-delete retrofit (plan Risk R8) — add a nullable `deletedAt` to
--    EmailSuppression + Notification so `unsuppress()` and in-app dismissal
--    keep the audit trail instead of hard-deleting. Both are registered in
--    SOFT_DELETE_MODELS so the Prisma middleware auto-filters reads.
--
-- Forward-safe: the two ADD COLUMNs are nullable, so every existing row gets
-- `deletedAt = NULL` (= active) and behaviour is unchanged for current data.
-- The new table is empty on create.
--
-- Rollback:
--   DROP TABLE "NotificationPreference";
--   ALTER TABLE "EmailSuppression" DROP COLUMN "deletedAt";
--   ALTER TABLE "Notification" DROP COLUMN "deletedAt";
-- Purely additive — no data loss on rollback, no backfill to reverse.

-- ── New consent model ───────────────────────────────────────────────────────
CREATE TABLE "NotificationPreference" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "category"  TEXT NOT NULL,
  "email"     BOOLEAN NOT NULL DEFAULT false,
  "sms"       BOOLEAN NOT NULL DEFAULT false,
  "push"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_category_key"
  ON "NotificationPreference" ("userId", "category");
CREATE INDEX "NotificationPreference_userId_idx"
  ON "NotificationPreference" ("userId");
CREATE INDEX "NotificationPreference_deletedAt_idx"
  ON "NotificationPreference" ("deletedAt");

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Soft-delete retrofit (Risk R8) ──────────────────────────────────────────
ALTER TABLE "EmailSuppression" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "EmailSuppression_deletedAt_idx" ON "EmailSuppression" ("deletedAt");

ALTER TABLE "Notification" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "Notification_deletedAt_idx" ON "Notification" ("deletedAt");
