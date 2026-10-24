-- NE8 — NotificationLog provider-message-id lookup index (plan Risk R7).
--
-- The inbound Resend webhook (resend-webhook.service.ts findLogByProviderId)
-- reconciles each delivery/bounce/complaint event back to its NotificationLog
-- via a Prisma filter `{ metadata: { path: ['providerMessageId'], equals } }`,
-- which Postgres compiles to a scalar text-equality on an extracted JSONB value:
--     metadata->>'providerMessageId' = $1
-- That is served by a BTREE EXPRESSION index on the extracted text, NOT a GIN
-- index (GIN accelerates containment `@>` / multi-value searches, not `=` on an
-- extracted scalar). The plan §8 R7 wording "GIN index on metadata.providerMessageId"
-- is imprecise for this access pattern; the btree expression index below is the
-- correct, query-matching choice (verified by the NE8 pre-impl probe).
--
-- Forward-safe + idempotent: additive index only, no table rewrite, no data
-- change; IF NOT EXISTS makes a re-run a no-op. Building it briefly takes a
-- SHARE lock on NotificationLog — acceptable for this table's volume. It is
-- intentionally NOT `CREATE INDEX CONCURRENTLY`, because `prisma migrate deploy`
-- wraps each migration in a transaction and CONCURRENTLY cannot run inside one;
-- a plain CREATE INDEX is transaction-safe.
--
-- Rollback:
--   DROP INDEX IF EXISTS "NotificationLog_providerMessageId_idx";

CREATE INDEX IF NOT EXISTS "NotificationLog_providerMessageId_idx"
  ON "NotificationLog" ((metadata->>'providerMessageId'));
