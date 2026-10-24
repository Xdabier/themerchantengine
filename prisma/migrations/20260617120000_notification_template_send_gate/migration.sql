-- NE1 — per-feature email kill-switch (notifications-email-engine).
--
-- Splits the conflated NotificationTemplate.isEnabled flag into a real
-- send-gate (`sendEnabled`) consulted by MailService.enqueue before the BullMQ
-- queue add, plus a delivery `category` (drives the NE7 consent/unsubscribe
-- gate) and an `isLocked` flag for the non-disableable security/legal flows.
--
-- Forward-safe: all three columns are NOT NULL with defaults, so every
-- existing row is left sendable (`sendEnabled=true`) — the migration never
-- silently darkens a flow operators believed was sending (plan Risk R2).
-- The backfill locks the constitutional non-disableable set (auth.* + order.*);
-- refund-confirmation flows do not exist until phase NE5.
--
-- Rollback:
--   ALTER TABLE "NotificationTemplate"
--     DROP COLUMN "sendEnabled",
--     DROP COLUMN "category",
--     DROP COLUMN "isLocked";
-- Purely additive — no data loss on rollback, no backfill to reverse.

ALTER TABLE "NotificationTemplate"
  ADD COLUMN "sendEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'TRANSACTIONAL',
  ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false;

-- Lock the non-disableable set (operator decision 2): the admin UI renders
-- these toggles read-only and MailService.enqueue refuses to skip them.
UPDATE "NotificationTemplate"
  SET "isLocked" = true
  WHERE "code" LIKE 'auth.%' OR "code" LIKE 'order.%';
