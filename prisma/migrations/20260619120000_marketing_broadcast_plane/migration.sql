-- NE9 — marketing / broadcast plane (notifications-email-engine).
--
-- Three new models for the isolated, batched, consent-gated marketing plane:
--   1. Subscriber    — the newsletter audience (anonymous or account-linked);
--                      double opt-in via `confirmedAt`, one-click opt-out via
--                      `unsubscribedAt`.
--   2. Campaign      — an operator-composed (BROADCAST) or system (WINBACK)
--                      marketing send; Translatable subject/body; sent on the
--                      separate `campaign` BullMQ queue, never the `mail` queue.
--   3. CampaignSend  — per-recipient send audit (mirrors NotificationLog); the
--                      (campaignId, recipient) unique is the at-most-once guard.
--
-- All three carry `deletedAt` soft-delete (§3.4) and are registered in
-- SOFT_DELETE_MODELS so the Prisma middleware auto-filters reads.
--
-- Forward-safe: purely additive (three empty tables + two new User back-relations
-- that are virtual, no User column change). No backfill, no data touched.
--
-- Rollback:
--   DROP TABLE "CampaignSend";
--   DROP TABLE "Campaign";
--   DROP TABLE "Subscriber";
-- Purely additive — no data loss on rollback.

-- ── Subscriber ──────────────────────────────────────────────────────────────
CREATE TABLE "Subscriber" (
  "id"             TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "userId"         TEXT,
  "locale"         TEXT NOT NULL DEFAULT 'ar',
  "source"         TEXT NOT NULL,
  "confirmedAt"    TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscriber_email_key" ON "Subscriber" ("email");
CREATE INDEX "Subscriber_userId_idx" ON "Subscriber" ("userId");
CREATE INDEX "Subscriber_confirmedAt_idx" ON "Subscriber" ("confirmedAt");
CREATE INDEX "Subscriber_unsubscribedAt_idx" ON "Subscriber" ("unsubscribedAt");
CREATE INDEX "Subscriber_deletedAt_idx" ON "Subscriber" ("deletedAt");

ALTER TABLE "Subscriber"
  ADD CONSTRAINT "Subscriber_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Campaign ────────────────────────────────────────────────────────────────
CREATE TABLE "Campaign" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "subject"     JSONB NOT NULL,
  "body"        JSONB NOT NULL,
  "segment"     TEXT NOT NULL,
  "couponCode"  TEXT,
  "status"      TEXT NOT NULL DEFAULT 'DRAFT',
  "kind"        TEXT NOT NULL DEFAULT 'BROADCAST',
  "windowKey"   TEXT,
  "scheduledAt" TIMESTAMP(3),
  "sentAt"      TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Campaign_windowKey_key" ON "Campaign" ("windowKey");
CREATE INDEX "Campaign_status_idx" ON "Campaign" ("status");
CREATE INDEX "Campaign_segment_idx" ON "Campaign" ("segment");
CREATE INDEX "Campaign_kind_idx" ON "Campaign" ("kind");
CREATE INDEX "Campaign_scheduledAt_idx" ON "Campaign" ("scheduledAt");
CREATE INDEX "Campaign_createdById_idx" ON "Campaign" ("createdById");
CREATE INDEX "Campaign_deletedAt_idx" ON "Campaign" ("deletedAt");

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── CampaignSend ────────────────────────────────────────────────────────────
CREATE TABLE "CampaignSend" (
  "id"                TEXT NOT NULL,
  "campaignId"        TEXT NOT NULL,
  "subscriberId"      TEXT,
  "recipient"         TEXT NOT NULL,
  "status"            TEXT NOT NULL,
  "providerMessageId" TEXT,
  "error"             TEXT,
  "dedupeKey"         TEXT,
  "sentAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"         TIMESTAMP(3),
  CONSTRAINT "CampaignSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignSend_campaignId_recipient_key"
  ON "CampaignSend" ("campaignId", "recipient");
CREATE INDEX "CampaignSend_campaignId_idx" ON "CampaignSend" ("campaignId");
CREATE INDEX "CampaignSend_subscriberId_idx" ON "CampaignSend" ("subscriberId");
CREATE INDEX "CampaignSend_status_idx" ON "CampaignSend" ("status");
CREATE INDEX "CampaignSend_providerMessageId_idx" ON "CampaignSend" ("providerMessageId");
CREATE INDEX "CampaignSend_deletedAt_idx" ON "CampaignSend" ("deletedAt");

ALTER TABLE "CampaignSend"
  ADD CONSTRAINT "CampaignSend_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignSend"
  ADD CONSTRAINT "CampaignSend_subscriberId_fkey"
  FOREIGN KEY ("subscriberId") REFERENCES "Subscriber" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
