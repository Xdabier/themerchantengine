/**
 * Repairs `variantLabel` columns that were written as "[object Object]"
 * (finding AD2).
 *
 * `CartItem.variantLabel` and `OrderItem.variantLabel` are plain text columns.
 * Four write sites used to join `attributeValue.value` straight into a string,
 * and every `AttributeValue.value` row in this store is a Translatable object,
 * so each attribute on a variant contributed one literal "[object Object]" to
 * the snapshot. The write sites now resolve through `buildVariantLabel`; this
 * script repairs the rows they already wrote.
 *
 * Two passes per table, in one transaction:
 *
 *   1. Rebuild from `VariantAttributeValue` for every row whose `variantId`
 *      still resolves to a variant that has attribute values.
 *   2. Null out whatever is left. A corrupt label with no resolvable source is
 *      not recoverable, and null is what the readers already treat as "this
 *      line has no variant distinction". Guessing would put fiction on an
 *      invoice.
 *
 * The rebuild resolves on the `default` rung, then `en`. A backfill has no
 * request behind it, so there is no locale to honour, and `default` is the
 * value the store itself chose. That is the same chain
 * `resolveTranslatable(value, 'default')` walks.
 *
 * Attribute order is `sortOrder` then `id`, which is the order the write sites
 * now use too, so a repaired row and a fresh one read the same.
 *
 * Idempotent: the `LIKE '%[object Object]%'` guard is the whole selector, so a
 * second run matches nothing and a row the application has since rewritten is
 * never touched.
 *
 * Written as a script rather than as migration SQL for the same reason as
 * `backfill-order-status-history.ts`: this repository applies its schema with
 * `prisma db push`, which runs no migration body.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const CORRUPT = `"variantLabel" LIKE '%[object Object]%'`;

/**
 * One label per variant, resolved and joined the way the write sites do.
 * A variant whose every attribute value fails to resolve produces no row here
 * and falls through to the null pass.
 */
const REBUILT_LABELS = `
  SELECT
    vav."variantId" AS variant_id,
    string_agg(
      COALESCE(av."value" ->> 'default', av."value" ->> 'en'),
      ', ' ORDER BY av."sortOrder", av."id"
    ) AS label
  FROM "VariantAttributeValue" vav
  JOIN "AttributeValue" av ON av."id" = vav."attributeValueId"
  WHERE COALESCE(av."value" ->> 'default', av."value" ->> 'en') IS NOT NULL
  GROUP BY vav."variantId"
`;

function rebuildSql(table: string): string {
  return `
    WITH rebuilt AS (${REBUILT_LABELS})
    UPDATE "${table}" t
    SET "variantLabel" = r.label
    FROM rebuilt r
    WHERE t."variantId" = r.variant_id
      AND t.${CORRUPT};
  `;
}

function clearSql(table: string): string {
  return `UPDATE "${table}" SET "variantLabel" = NULL WHERE ${CORRUPT};`;
}

export type VariantLabelBackfillResult = {
  orderItemsRebuilt: number;
  orderItemsCleared: number;
  cartItemsRebuilt: number;
  cartItemsCleared: number;
};

export async function backfillVariantLabels(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<VariantLabelBackfillResult> {
  if (!databaseUrl) {
    throw new Error('[db:variant-labels] DATABASE_URL is not set');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // One transaction, so a row can never be left corrupt-but-unrebuilt
    // because the process died between the two passes.
    await client.query('BEGIN');

    const orderItemsRebuilt = (await client.query(rebuildSql('OrderItem'))).rowCount ?? 0;
    const orderItemsCleared = (await client.query(clearSql('OrderItem'))).rowCount ?? 0;
    const cartItemsRebuilt = (await client.query(rebuildSql('CartItem'))).rowCount ?? 0;
    const cartItemsCleared = (await client.query(clearSql('CartItem'))).rowCount ?? 0;

    await client.query('COMMIT');

    return { orderItemsRebuilt, orderItemsCleared, cartItemsRebuilt, cartItemsCleared };
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
  backfillVariantLabels()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(
        `[db:variant-labels] OK - OrderItem ${r.orderItemsRebuilt} rebuilt, ` +
          `${r.orderItemsCleared} cleared; CartItem ${r.cartItemsRebuilt} rebuilt, ` +
          `${r.cartItemsCleared} cleared`,
      );
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[db:variant-labels] failed:', err);
      process.exit(1);
    });
}
