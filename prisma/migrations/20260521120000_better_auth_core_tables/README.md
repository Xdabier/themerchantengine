# Migration: Better Auth core tables + data backfill

**Phase:** BA2 (better-auth-migration track)
**Records:** DR-24 (migrate authentication from custom JWT to Better Auth cookie sessions)
**Pattern:** Additive expand migration (`merchants-migration-author` skill)

## What this migration does

1. **Creates the four Better Auth tables** — `Session`, `Account`, `Verification`, `TwoFactor`. All carry a string PK; `Session`/`Account`/`TwoFactor` have a `userId` FK to `User` with `ON DELETE CASCADE`; `Session.token` is unique; `userId` (and `Verification.identifier`) are indexed.
2. **Adds two columns to `User`** — `name` (NOT NULL, see the backfill below) and `twoFactorEnabled` (nullable, default `false`, set by the twoFactor plugin).
3. **Backfills the existing `User` rows** so the cutover is non-destructive:
   - `name` ← `firstName || ' ' || lastName` (added nullable, backfilled, then `SET NOT NULL`).
   - `emailVerified` → `true` for every existing user — pre-migration users are grandfathered (clarification Q2), so the one-time forced re-login is not compounded by a verification lockout.
   - one `Account` row per password-holding user (`providerId: 'credential'`, `accountId: <user id>`, `password: <existing bcrypt hash>`) — the existing hash is carried verbatim, so **no user needs a password reset at cutover**.

`RefreshToken`, `User.passwordHash`, `Role`, and `RolePermission` are **unchanged**. `RefreshToken` and `passwordHash` are retained through cutover as the rollback safety net and dropped only in a follow-up migration after the BA5 production canary is green.

## Why this migration is additive and backward-compatible

Every change is additive — new tables, new columns, backfilled data. Nothing existing is altered or dropped. The pre-migration custom-JWT code tolerates the new tables and columns (it simply never reads them), and the new Better Auth code reads them. The schema can therefore be applied ahead of the code with zero coupling — see the deploy order below.

## Rollback plan

The migration is additive, so a revert loses no irrecoverable data:

1. **Forward-revert migration** drops the additions:

   ```sql
   ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";
   ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_fkey";
   ALTER TABLE "TwoFactor" DROP CONSTRAINT "TwoFactor_userId_fkey";
   DROP TABLE "Session", "Account", "Verification", "TwoFactor";
   ALTER TABLE "User" DROP COLUMN "name";
   ALTER TABLE "User" DROP COLUMN "twoFactorEnabled";
   ```

2. **No data export step is needed.** `Account.password` is a verbatim copy of `User.passwordHash`, which is retained — dropping `Account` loses nothing. `User.name` is re-derivable from `firstName`/`lastName`. `Session` rows are live sessions only (a revert forces a re-login, which is the cutover behaviour anyway). `Verification`/`TwoFactor` hold no data pre-cutover.

3. **Migration ships but code reverts:** safe. The new tables/columns are additive; the custom-JWT code ignores them. No runtime breakage.

4. **Code ships but migration reverted:** not allowed — schema must precede code (below). Better Auth's adapter would error on the missing tables.

5. **Rollback window:** `RefreshToken` and `User.passwordHash` are kept for exactly this — reverting to the custom stack stays possible until the post-BA5 follow-up migration drops them.

## Code-vs-schema deploy order

Schema **must precede** code:

1. `npx prisma migrate deploy` — applies this migration.
2. Roll the API workers — the new schema is compatible with both the old code (ignores the new tables) and the new Better Auth code.
3. Deploy the new code.

The production execution runs in a low-traffic window per the BA5 runbook (`tasks.md` BA5.4): every existing user is signed out exactly once (old `RefreshToken` rows and in-memory tokens become meaningless); re-login is frictionless because the password hashes are preserved.

## Concurrent-write safety + scale

The script runs inside Prisma's implicit transaction; the `CREATE TABLE` / `ALTER TABLE` statements take a brief `ACCESS EXCLUSIVE` lock on `User`, and concurrent writes block until the migration completes. For a single-store customer base the `User` row count is well under 10K and the lock window is sub-second.

For a customer base over ~10K rows the `name` / `emailVerified` / `Account` backfills should be rehearsed on a staging copy first, and — if the lock window proves material — staged: add the columns nullable, backfill in batches outside the migration transaction, then tighten `NOT NULL` and add the FK in a follow-up. The BA5 runbook owns the production rehearsal.
