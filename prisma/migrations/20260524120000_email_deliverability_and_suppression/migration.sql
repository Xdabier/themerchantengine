-- Resend transactional-email rollout.
--
-- Adds:
--   1. User.emailDeliverability / emailBouncedAt / emailComplainedAt
--      — populated by the Resend webhook listener so MailService can
--        short-circuit future sends to a known-bad address.
--   2. EmailSuppression — explicit allow-list of "do not send" addresses.
--        Inserted on email.complained (always) and on email.bounced with
--        bounce.type=hard. Operators can also insert reason="operator.manual"
--        rows by hand from admin SQL.
--
-- Forward-safe: all columns are nullable; the new model has no FK; existing
-- NotificationLog rows untouched (status column stays String, no enum lift,
-- so future status values like "queued"/"complained"/"suppressed" land
-- without further migration).

-- ── User additions ──────────────────────────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN "emailDeliverability" TEXT,
  ADD COLUMN "emailBouncedAt" TIMESTAMP(3),
  ADD COLUMN "emailComplainedAt" TIMESTAMP(3);

-- ── EmailSuppression model ──────────────────────────────────────────────────
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailSuppression_email_key" ON "EmailSuppression"("email");
CREATE INDEX "EmailSuppression_email_idx" ON "EmailSuppression"("email");
