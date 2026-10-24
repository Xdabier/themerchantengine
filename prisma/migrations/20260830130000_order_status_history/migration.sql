-- Plan M phase M2 (order lifecycle seam), finding AD6.
--
-- WHAT
--   A new append-only table, `OrderStatusHistory`, recording every order status
--   transition, plus a backfill giving existing orders a two-row timeline.
--
-- WHY
--   The customer order page rendered a one-row timeline stamped with the time
--   the order was placed, whatever had happened since, because the API sent no
--   history and the page fell back to `{ status, createdAt }`. The only record
--   of a transition was the `order.status_changed` `AuditLogEntry` row, which is
--   not usable for this: its writer is wrapped in try/catch so it can silently
--   miss, it carries staff ids a customer must not see, and it is written
--   outside the transaction that moves the order.
--
-- WHO WRITES IT
--   `OrdersService`, inside the transactions that already exist:
--   `createOrder` and `createManualOrder` nest the birth row into the order
--   create, and `updateStatus` writes the transition row inside the same
--   transaction as the WHERE-guarded status write. A transition therefore lands
--   with its history row or does not land at all, and a lost status race writes
--   neither.
--
-- ON DELETE CASCADE, DELIBERATELY
--   `Shipment` uses `Restrict` because a shipment is a real-world artifact worth
--   blocking a delete over. This table is a subordinate log of one order and is
--   meaningless without it, so `Cascade` is the honest semantic. It also keeps
--   every existing test cleanup that deletes orders working unchanged; `Restrict`
--   would have broken each of them with a foreign-key error.
--
-- BACKFILL, AND WHY IT IS NOT RUN FROM THIS FILE
--   This repository applies its schema with `prisma db push`, not
--   `prisma migrate deploy` (clarifications §1.34). `db push` creates the table
--   and runs none of this file, so a backfill living only here would never
--   execute on dev, on the e2e database, or on prod. The executable copy is
--   `prisma/backfill-order-status-history.ts`, wired into `npm run db:setup`,
--   into `test/e2e-global-setup.ts`, and into the `migrate-db` CI job after the
--   seed. The SQL below is the same statements, kept here for the migrate lane
--   and as the written record.
--
--   Each backfilled order gets at most two rows: a PENDING birth row at its
--   `createdAt`, and, when it has moved on, one row carrying its current status
--   stamped `deliveredAt` for a DELIVERED order and `updatedAt` otherwise. Not a
--   reconstructed walk: the intermediate transitions were never recorded, and
--   inventing plausible timestamps would put fiction in front of a customer.
--
--   Idempotent, by two guards that are deliberately different from each other.
--   The first is "no rows at all". The second is scoped to `toStatus <> 'PENDING'`
--   because both statements share one transaction, so the second sees the birth
--   row the first just wrote; a plain NOT EXISTS there would suppress it and no
--   order would ever get its current-status row. That detail looks like an
--   oversight and is not.
--
--   What the guard does NOT repair: an order whose status was written by
--   something other than `OrdersService.updateStatus`. Such an order already
--   holds a non-PENDING row, so it is skipped forever. `ReturnsService` was the
--   one such writer and now goes through `updateStatus`; any future bypass would
--   reopen the hole permanently, which is why the order state machine is the
--   only thing allowed to write `Order.status`.
--
-- ORDERING AND ROLLBACK
--   Forward: schema first, code second. New code against a missing table fails
--   on the nested create in `createOrder`.
--
--   Old code against the new table is safe in both directions and at all times:
--   nothing in the pre-M2 client selects, writes or types `statusHistory`, and
--   the column set of every existing table is untouched. That makes this the
--   opposite of the M1 enum change, which could not be reverted once a row
--   carried the new value.
--
--   Rollback is therefore a plain code revert. The table can be left in place
--   holding its rows; it costs one unused relation. While reverted, new orders
--   accumulate with no history at all, which is harmless: rolling forward picks
--   every one of them up on the next backfill run, because the first INSERT's
--   guard is "no rows at all". Dropping it is
--   `DROP TABLE "OrderStatusHistory";`, which is destructive and loses the only
--   record of every transition since deploy, so it should be a separate,
--   deliberate decision rather than part of an incident rollback.
--
-- DATA IMPACT
--   No existing column, index or constraint is altered. The backfill writes at
--   most two rows per existing order and reads nothing it does not write.
--
-- INVALIDATED STATE
--   None. No cached session, permission matrix, or Translatable resolution
--   cache keys on order status history.

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the birth row every order has.
INSERT INTO "OrderStatusHistory" ("id", "orderId", "fromStatus", "toStatus", "createdAt")
SELECT gen_random_uuid()::text, o."id", NULL, 'PENDING'::"OrderStatus", o."createdAt"
FROM "Order" o
WHERE NOT EXISTS (
  SELECT 1 FROM "OrderStatusHistory" h WHERE h."orderId" = o."id"
);

-- Backfill: where the order actually is now, for those that moved on.
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
