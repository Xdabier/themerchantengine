-- Money and tax.
--
-- Some currencies have three decimals: 1 unit = 1000 millimes. Every
-- money column in this schema was numeric(10,2), so Postgres silently rounded
-- the millime away on write. This widens all 34 of them to numeric(12,3), and
-- moves the two currency column defaults from QAR to TND.
--
-- WHY (12,3) AND NOT (10,3)
--   (10,3) is NOT a widening. Precision stays at 10 while scale grows from 2
--   to 3, so the integral range SHRINKS from 99,999,999.99 to 9,999,999.999,
--   a factor of ten. Under db push --accept-data-loss that narrowing is
--   applied without a prompt and truncates the largest amounts on the spot.
--   (12,3) keeps nine integral digits and gains the millime.
--
-- COLUMN CENSUS, verified three ways
--   Statically, against prisma/schema.prisma:
--     34 x @db.Decimal(10, 2)   money            -> (12,3), listed below
--      6 x @db.Decimal(8, 3)    weight/dimension -> UNCHANGED
--      2 x @db.Decimal(5, 4)    tax rates        -> UNCHANGED
--     42 Decimal columns total; no bare Decimal without a native type.
--   Against the live dev database via information_schema.columns, which
--   returned the same 34/6/2 split, so the schema file is a faithful
--   description of what is deployed — worth checking on a repository that
--   has run --accept-data-loss since inception.
--   And against Prisma own engine, run file-to-file so it never touched a
--   database: prisma migrate diff --from-schema ... --to-schema ... --script
--   emits exactly these 34 type changes across 12 tables plus the 2 defaults.
--
--   One of the 34 is polymorphic rather than money: Promotion.value holds a
--   percentage for a PERCENTAGE promotion and an amount for a FIXED_AMOUNT
--   one (see its doc comment in schema.prisma). Widening is safe for both
--   readings and it stays in the set, but a later audit asking "is every
--   money column at (12,3)" will find one column that is sometimes a rate.
--
-- WHAT MUST NOT BE SWEPT, and why it is spelled out
--   TaxZone.rate and TaxClass.rate are numeric(5,4) and stay there. They are
--   RATES, not money. Widening them to (12,3) would drop scale from 4 to 3:
--   0.1900 (19%) survives, but any rate needing a fourth decimal — 7.25% is
--   0.0725 — becomes 0.073 and every tax computation in the store is quietly
--   wrong. The narrow type is also an ACTIVE GUARD rather than just a
--   preserved scale: (5,4) permits one integral digit, so a bug that writes
--   a percentage where a fraction belongs (19.0000 instead of 0.1900) raises
--   numeric field overflow and fails loudly rather than charging 1900 per
--   cent VAT. At (12,3) that bug would have nine integral digits to hide in.
--   The six (8,3) columns are kilograms and centimetres.
--   A sweep phrased as "every Decimal becomes (12,3)" hits all eight.
--
-- WHAT THIS MIGRATION CANNOT REACH
--   Five money carriers live in Json columns, which have no scale, so no
--   ALTER can touch them and — the useful half — nothing was ever truncated
--   in them either. There is no precision debt here and no backfill owed:
--     ShippingMethod.weightRanges   [{minKg, maxKg, price}]
--     ShippingMethod.priceRanges    [{minAmount, maxAmount, price}]
--     Invoice.items                 line snapshots incl. unitPrice and total
--     Invoice.taxBreakdown
--     Promotion.tierConfig          [{min, max, value}] for tiered pricing
--   The exposure is unvalidated INPUT rather than lost precision: the
--   shipping range DTOs carried no element validator at all, so an
--   out-of-scale price reached the column and was returned as a live
--   shipping charge. Fixed in the same phase, in create-method.dto.ts.
--
-- SAFETY
-- - Widening numeric precision and scale preserves every existing value
--   exactly; 12.34 becomes 12.340. No backfill, no data transformation.
-- - Postgres rewrites the table for a numeric type change, so each ALTER
--   takes an ACCESS EXCLUSIVE lock for the duration of the rewrite.
--   Statements are batched one per TABLE rather than one per column, which
--   is what db push itself emits: twelve rewrites rather than thirty-four.
-- - Measured on the dev database: under 3 MB across all twelve tables, so
--   the locks are held for milliseconds and the "instant on a greenfield
--   database" claim holds. On a POPULATED database the expensive tables are
--   OrderItem, then Cart and CartItem (a row per session, including every
--   abandoned anonymous cart), then Order, whose lock is the most
--   user-visible because checkout writes to it. Rehearse there.
-- - The currency defaults apply to NEW rows only. Existing Order and
--   GiftCard rows keep the currency they were written in, which is correct:
--   an order is an immutable record of what was actually charged, and no FX
--   conversion accompanies a retro-stamp.
--
--   The consequence is a table that CAN hold two currencies, and seven
--   aggregate reads sum across it with no currency filter or group-by:
--   analytics.service.ts getPeriodStats, getRevenueAnalytics,
--   getCustomerAnalytics and the revenue timeseries; orders.service.ts
--   getStats; users.service.ts enrichCustomers; and the staff-digest
--   processor's weekly KPI email. D4 quantised the float arithmetic at those
--   sites but did NOT scope them by currency, and this note previously
--   claimed otherwise. It is corrected here rather than left overclaiming.
--
--   The exposure on the target deployment is nil: its database is greenfield,
--   and the demo seed now writes TND on every order it
--   plants, so no database this phase creates is mixed. It becomes real for a
--   store that changes currency mid-life, and the fix is a reporting-semantics
--   decision (report in the store currency only, or convert) rather than a
--   precision one, so it belongs with the operator. Recorded in tasks.md
--   under "deliberately out of scope" with that reasoning.
--
-- DEPLOY HAZARD, read before adding a branch rule
--   Deploy jobs are gated on one client branch, and the target box comes from
--   flat CI project variables rather than from the branch. Adding a rule for
--   a second client branch before those variables are branch-scoped would run
--   these 34 alters against the first client's production database, which
--   may be populated, in another currency, and carry real orders.
--
-- HOW THIS ACTUALLY REACHES A DATABASE
--   Not through prisma migrate deploy. This repository deploys with
--   prisma db push --accept-data-loss reading prisma/schema.prisma
--   (the CI migrate-db job), so the schema
--   lines are what apply the change and this file is the written record of
--   intent plus a manual rollback statement. Verified that db push emits the
--   same semantic DDL as the statements below.
--   This change does NOT interact with the searchVector column that
--   --accept-data-loss is known to drop: searchVector lives on Product, and
--   no column on Product is altered here.

BEGIN;
ALTER TABLE "ProductVariant"
  ALTER COLUMN "price" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "compareAtPrice" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "costPrice" SET DATA TYPE numeric(12,3);

ALTER TABLE "Cart"
  ALTER COLUMN "subtotal" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "discountAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "shippingEstimate" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "taxEstimate" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "total" SET DATA TYPE numeric(12,3);

ALTER TABLE "CartItem"
  ALTER COLUMN "unitPrice" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "compareAtPrice" SET DATA TYPE numeric(12,3);

ALTER TABLE "Order"
  ALTER COLUMN "subtotal" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "discountAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "shippingAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "taxAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "total" SET DATA TYPE numeric(12,3);

ALTER TABLE "OrderItem"
  ALTER COLUMN "unitPrice" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "discountAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "taxAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "total" SET DATA TYPE numeric(12,3);

ALTER TABLE "Invoice"
  ALTER COLUMN "subtotal" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "discountAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "shippingAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "taxAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "total" SET DATA TYPE numeric(12,3);

ALTER TABLE "Return"
  ALTER COLUMN "refundAmount" SET DATA TYPE numeric(12,3);

ALTER TABLE "Promotion"
  ALTER COLUMN "value" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "minimumOrderAmount" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "maximumDiscount" SET DATA TYPE numeric(12,3);

ALTER TABLE "PromotionUsage"
  ALTER COLUMN "discountAmount" SET DATA TYPE numeric(12,3);

ALTER TABLE "GiftCard"
  ALTER COLUMN "initialBalance" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "currentBalance" SET DATA TYPE numeric(12,3);

ALTER TABLE "GiftCardTransaction"
  ALTER COLUMN "amount" SET DATA TYPE numeric(12,3);

ALTER TABLE "ShippingMethod"
  ALTER COLUMN "price" SET DATA TYPE numeric(12,3),
  ALTER COLUMN "freeAbove" SET DATA TYPE numeric(12,3);

ALTER TABLE "Order" ALTER COLUMN "currency" SET DEFAULT 'TND';
ALTER TABLE "GiftCard" ALTER COLUMN "currency" SET DEFAULT 'TND';

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK — DESTRUCTIVE AND NOT SYMMETRIC. READ ALL OF THIS FIRST.
--
-- Narrowing (12,3) back to (10,2) loses data in TWO different ways, and the
-- second one fails hard rather than quietly:
--
--   1. Scale 3 to 2 ROUNDS SILENTLY. 12.345 becomes 12.35, permanently,
--      with no record of what it was. Safe only while no millime-precision
--      value has ever been written.
--   2. Precision 12 to 10 also drops an INTEGRAL digit. (12,3) holds up to
--      999,999,999.999; (10,2) holds up to 99,999,999.99. Any row at or
--      above 100,000,000 does not round on the way back. It raises
--      numeric field overflow and aborts the statement.
--
-- Because of (2) the rollback can fail partway, which is why it is wrapped
-- in a transaction below. Without the wrapper an overflow on one table
-- leaves the database half-reverted with nothing recording where it stopped.
--
-- BEGIN;
--
-- ALTER TABLE "ProductVariant"
--   ALTER COLUMN "price" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "compareAtPrice" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "costPrice" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "Cart"
--   ALTER COLUMN "subtotal" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "discountAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "shippingEstimate" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "taxEstimate" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "total" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "CartItem"
--   ALTER COLUMN "unitPrice" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "compareAtPrice" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "Order"
--   ALTER COLUMN "subtotal" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "discountAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "shippingAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "taxAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "total" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "OrderItem"
--   ALTER COLUMN "unitPrice" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "discountAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "taxAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "total" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "Invoice"
--   ALTER COLUMN "subtotal" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "discountAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "shippingAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "taxAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "total" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "Return"
--   ALTER COLUMN "refundAmount" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "Promotion"
--   ALTER COLUMN "value" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "minimumOrderAmount" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "maximumDiscount" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "PromotionUsage"
--   ALTER COLUMN "discountAmount" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "GiftCard"
--   ALTER COLUMN "initialBalance" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "currentBalance" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "GiftCardTransaction"
--   ALTER COLUMN "amount" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "ShippingMethod"
--   ALTER COLUMN "price" SET DATA TYPE numeric(10,2),
--   ALTER COLUMN "freeAbove" SET DATA TYPE numeric(10,2);
--
-- ALTER TABLE "Order" ALTER COLUMN "currency" SET DEFAULT 'QAR';
-- ALTER TABLE "GiftCard" ALTER COLUMN "currency" SET DEFAULT 'QAR';
--
-- COMMIT;
