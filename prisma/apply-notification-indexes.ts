/**
 * Re-applies the raw-SQL NotificationLog indexes that are NOT expressible in
 * `schema.prisma` and would therefore be dropped by every
 * `prisma db push --accept-data-loss` (the same class of problem as the FTS
 * setup — see `prisma/apply-fts-setup.ts`).
 *
 * Today this is the single provider-message-id lookup index (plan Risk R7): a
 * BTREE expression index on `metadata->>'providerMessageId'` that serves the
 * inbound Resend webhook reconciliation (`resend-webhook.service.ts`
 * findLogByProviderId, whose Prisma `{ path:['providerMessageId'], equals }`
 * compiles to `metadata->>'providerMessageId' = $1`).
 *
 * The committed migration `20260618170000_notification_log_provider_message_id_idx`
 * is the PROD `migrate deploy` artifact (prod uses migrate, not db push, so it
 * persists there). This applier re-installs the same index after every dev / e2e
 * `db push`. Idempotent: `CREATE INDEX IF NOT EXISTS`.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS "NotificationLog_providerMessageId_idx" ` +
    `ON "NotificationLog" ((metadata->>'providerMessageId'));`,
];

export async function applyNotificationIndexes(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  if (!databaseUrl) {
    throw new Error('[db:notification-indexes] DATABASE_URL is not set');
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const sql of STATEMENTS) {
      await client.query(sql);
    }
    // eslint-disable-next-line no-console
    console.log('[db:notification-indexes] OK — NotificationLog metadata index ensured');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  applyNotificationIndexes().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[db:notification-indexes] failed:', err);
    process.exit(1);
  });
}
