/**
 * Backfills `OrderStatusHistory` for orders that predate it (finding AD6).
 *
 * This exists as a script rather than as SQL inside the migration because this
 * repository applies its schema with `prisma db push`, not `prisma migrate
 * deploy` (clarifications §1.34). `db push` creates the table and runs none of
 * the migration body, so a backfill written only in the migration file would
 * never execute on dev, on the e2e database, or on prod. Same reasoning as
 * `apply-fts-setup.ts` and `backfill-notification-bodies.ts`.
 *
 * What it writes, per order with no history rows at all:
 *
 *   1. The birth row: `toStatus = PENDING` at the order's `createdAt`. Every
 *      order starts there; nothing else is knowable.
 *   2. When the order is not still PENDING, one more row carrying its current
 *      status, stamped `deliveredAt` when that status is DELIVERED (the one
 *      transition whose real time is recorded) and `updatedAt` otherwise.
 *
 * Two rows, not a reconstructed walk. The intermediate transitions were never
 * recorded, and inventing plausible timestamps for them would put fiction in
 * front of a customer. A backfilled order shows where it started and where it
 * is; orders placed from now on show every step.
 *
 * Idempotent by the `NOT EXISTS` guards, which are deliberately different from
 * each other. The first is "no rows at all". The second is scoped to
 * `toStatus <> 'PENDING'` because both statements share one transaction, so the
 * second sees the birth row the first just wrote; a plain `NOT EXISTS` there
 * would suppress it and no order would ever get its current-status row.
 *
 * Re-running never duplicates and never touches an order the application has
 * since written to. It also picks up any order created by a reverted (pre-M2)
 * client, since such an order has no rows at all.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * `id` is `@default(cuid())` in the schema, which Prisma generates client-side,
 * so the column has no database default and the backfill has to supply one.
 * `gen_random_uuid()` is core Postgres since 13. The value only has to be
 * unique and opaque; nothing parses it.
 */
const BACKFILL_SQL = `
INSERT INTO "OrderStatusHistory" ("id", "orderId", "fromStatus", "toStatus", "createdAt")
SELECT gen_random_uuid()::text, o."id", NULL, 'PENDING'::"OrderStatus", o."createdAt"
FROM "Order" o
WHERE NOT EXISTS (
  SELECT 1 FROM "OrderStatusHistory" h WHERE h."orderId" = o."id"
);

INSERT INTO "OrderStatusHistory" ("id", "orderId", "fromStatus", "toStatus", "createdAt")
SELECT
  gen_random_uuid()::text,
  o."id",
  'PENDING'::"OrderStatus",
  o."status",
  GREATEST(
    COALESCE(CASE WHEN o."status" = 'DELIVERED' THEN o."deliveredAt" END, o."updatedAt"),
    o."createdAt" + interval '1 millisecond'
  )
FROM "Order" o
WHERE o."status" <> 'PENDING'
  AND NOT EXISTS (
    SELECT 1 FROM "OrderStatusHistory" h
    WHERE h."orderId" = o."id" AND h."toStatus" <> 'PENDING'
  );
`;

export async function applyOrderStatusHistoryBackfill(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  if (!databaseUrl) {
    throw new Error('[db:order-status-history] DATABASE_URL is not set');
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // One transaction: an order must never end up with a birth row and no
    // current-status row because the process died between the two statements.
    await client.query('BEGIN');
    await client.query(BACKFILL_SQL);
    const { rows } = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "OrderStatusHistory"',
    );
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(`[db:order-status-history] OK — ${rows[0]?.count ?? '0'} history rows present`);
  } catch (err) {
    // Never let the rollback replace the real error: if the connection is what
    // died, ROLLBACK throws too and the original cause is lost.
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the original error below is the one worth reporting */
    }
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  applyOrderStatusHistoryBackfill().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[db:order-status-history] failed:', err);
    process.exit(1);
  });
}
