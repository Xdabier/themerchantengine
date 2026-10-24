/**
 * Re-applies the partial-unique index enforcing one default shipping method per
 * zone — not expressible in `schema.prisma`, so `prisma db push` never creates
 * it. Same class of problem as the FTS setup (`prisma/apply-fts-setup.ts`) and
 * the NotificationLog index (`prisma/apply-notification-indexes.ts`).
 *
 * Prod installs this index via the CI migrate-db psql step
 * (`prisma/shipping_indexes.sql`, applied right after `db push`); this applier
 * re-installs the same index after every dev / e2e `db push` so the test DB
 * matches prod. Idempotent: `CREATE UNIQUE INDEX IF NOT EXISTS`.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const STATEMENTS = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "ShippingMethod_one_default_per_zone" ` +
    `ON "ShippingMethod" ("zoneId") WHERE "isDefault" AND "deletedAt" IS NULL;`,
];

export async function applyShippingIndexes(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  if (!databaseUrl) {
    throw new Error('[db:shipping-indexes] DATABASE_URL is not set');
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const sql of STATEMENTS) {
      await client.query(sql);
    }
    // eslint-disable-next-line no-console
    console.log('[db:shipping-indexes] OK — one-default-per-zone index ensured');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  applyShippingIndexes().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[db:shipping-indexes] failed:', err);
    process.exit(1);
  });
}
