-- ============================================================
-- BA2 — Better Auth core tables + data backfill (DR-24).
--
-- Adds the Better Auth schema — the Session, Account, Verification, and
-- TwoFactor tables, plus the User.name and User.twoFactorEnabled columns —
-- and backfills the existing User rows so the cutover is non-destructive:
--   * User.name          <- firstName || ' ' || lastName
--   * User.emailVerified -> true   (grandfather existing users, clarification Q2)
--   * Account            <- one `credential` row per password-holding user,
--                           carrying the existing bcrypt hash verbatim so no
--                           user needs a password reset at cutover
--
-- RefreshToken is intentionally retained — it is dropped in a separate
-- follow-up migration after the BA5 production canary is green (DR-24).
--
-- Lock posture: Prisma wraps the whole script in a single transaction; on any
-- failure the schema rolls back to its pre-migration state cleanly. The CREATE
-- TABLE / ALTER TABLE statements briefly take ACCESS EXCLUSIVE on "User"; the
-- backfill UPDATE / INSERT statements take row locks. At the production scale
-- of a single-store customer base the script completes in seconds. See the
-- companion README.md for the >10K-row staging-rehearsal note and the full
-- rollback plan.
-- ============================================================

-- ── CreateTable: Better Auth core tables ────────────────────────────────────
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- ── AlterTable: User.twoFactorEnabled (nullable, default false) ──────────────
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN DEFAULT false;

-- ── AlterTable: User.name — add nullable, backfill, then enforce NOT NULL ────
-- A bare `ADD COLUMN "name" TEXT NOT NULL` would fail on any populated User
-- table; the three-step pattern keeps the column non-nullable in the final
-- schema while remaining safe against existing rows.
ALTER TABLE "User" ADD COLUMN "name" TEXT;
UPDATE "User" SET "name" = "firstName" || ' ' || "lastName" WHERE "name" IS NULL;
ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;

-- ── Backfill: grandfather existing users as email-verified (clarification Q2) ─
-- Every user that exists at cutover is treated as verified; email verification
-- then applies to new registrations only, so the one-time forced re-login is
-- not compounded by a verification lockout.
UPDATE "User" SET "emailVerified" = true;

-- ── Backfill: a Better Auth `credential` Account per password-holding user ───
-- The existing bcrypt hash is carried verbatim into Account.password so no
-- user needs a password reset at cutover. accountId is set to the user id
-- (Better Auth's convention for the `credential` provider); the Account id is
-- derived from the user id so the backfill is deterministic and collision-free
-- without depending on a uuid extension.
INSERT INTO "Account" ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
SELECT
    'cred_' || "id",
    "id",
    "id",
    'credential',
    "passwordHash",
    "createdAt",
    CURRENT_TIMESTAMP
FROM "User"
WHERE "passwordHash" IS NOT NULL;

-- ── CreateIndex ──────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- ── AddForeignKey ────────────────────────────────────────────────────────────
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
