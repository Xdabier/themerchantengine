/**
 * One-shot repair for a database that an e2e run wrote into.
 *
 * Plan H, phase H1. The dev database the operator works against every day
 * accumulated Playwright fixtures for two weeks in May 2026: 127 fake shipping
 * zones out of 132, 10 live `E2E promo` coupons, four webhooks on
 * `example.com`, five CMS drafts, and the store contact email overwritten with
 * `support+<timestamp>@merchants.test`. Several admin modules were unusable
 * for real work. Phase H0 closed the way in; this closes what it left behind.
 *
 * Protocol, and it is not optional (plan H section 7): run with no flags,
 * READ the printed rows, then `--apply`, then run again and require every
 * count to be zero. A one-shot script that has never been run twice has not
 * been shown to be idempotent.
 *
 *   npx ts-node scripts/cleanup-e2e-fixtures.ts
 *   npx ts-node scripts/cleanup-e2e-fixtures.ts --apply
 *   npx ts-node scripts/cleanup-e2e-fixtures.ts            # expect 0 everywhere
 *
 * Flags:
 *   --apply                     write; without it nothing is changed
 *   --contact-email <address>   set the contact email instead of deleting the
 *                               row (deleting it restores the code default)
 *
 * What it deliberately does NOT do:
 *   - delete any User. `Order.userId` is `onDelete: SetNull`, so removing a
 *     customer orphans their orders permanently, and the seed converges only
 *     on `orderNumber`, so it never repairs them. Matching accounts are
 *     deactivated instead.
 *   - touch a GiftCard. Two of them are deliberate QA repro material owned by
 *     other plans.
 *   - touch an Order. Orders are append-only records.
 *   - purge rows that are already soft-deleted. They are invisible to the
 *     operator, and removing them buys nothing but foreign-key risk.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';
import {
  E2E_FIXTURE_PATTERNS,
  HELD_ROLE_QUERY,
  LEAKED_CONTACT_EMAIL_PREDICATE,
  PRODUCT_KEEP_SLUGS,
  assertLocalDevOrTestDatabase,
} from './e2e-fixture-patterns';
// Shared with the admin suite's global teardown so the reviewed one-shot repair
// and the unattended per-run sweep can never disagree about what they match.
import { applyPattern, matchRows } from './e2e-fixture-sweep';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const CONTEXT = 'cleanup-e2e-fixtures';
const APPLY = process.argv.includes('--apply');

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const CONTACT_EMAIL = flagValue('--contact-email');

/**
 * Roles a user still holds are skipped, never force-deleted.
 *
 * The database would not stop us: `User.roleId` is `onDelete: SetNull`, so
 * deleting the role silently strips the account instead of raising. The
 * warning is the only thing that would ever tell the operator.
 */
async function reportHeldRoles(client: Client): Promise<void> {
  const { rows } = await client.query<{ name: string; users: string }>(HELD_ROLE_QUERY);
  for (const row of rows) {
    console.warn(
      `  SKIPPED Role "${row.name}": ${row.users} user(s) still hold it. ` +
        'Reassign them first; deleting it would silently clear their role (SetNull).',
    );
  }
}

async function handleContactEmail(client: Client): Promise<number> {
  const { rows } = await client.query<{ value: string }>(
    `SELECT value #>> '{}' AS value FROM "StoreSetting" WHERE ${LEAKED_CONTACT_EMAIL_PREDICATE}`,
  );
  if (!rows.length) {
    console.log('StoreSetting general/contactEmail: no leaked value (0)');
    return 0;
  }
  console.log(`StoreSetting general/contactEmail: leaked value "${rows[0].value}" (1)`);
  if (!APPLY) return 1;

  if (CONTACT_EMAIL) {
    await client.query(
      `UPDATE "StoreSetting" SET value = to_jsonb($1::text) WHERE ${LEAKED_CONTACT_EMAIL_PREDICATE}`,
      [CONTACT_EMAIL],
    );
    console.log(`  set to "${CONTACT_EMAIL}"`);
  } else {
    await client.query(`DELETE FROM "StoreSetting" WHERE ${LEAKED_CONTACT_EMAIL_PREDICATE}`);
    console.log('  row deleted, so the code default in store.config.ts applies again');
  }
  return 1;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const database = assertLocalDevOrTestDatabase(url, CONTEXT);

  console.log(`[${CONTEXT}] database: ${database}`);
  console.log(`[${CONTEXT}] mode: ${APPLY ? 'APPLY (writes)' : 'dry-run (no writes)'}`);
  console.log(`[${CONTEXT}] product keep-list: ${PRODUCT_KEEP_SLUGS.join(', ')}`);
  console.log('');

  const client = new Client({ connectionString: url });
  await client.connect();

  let total = 0;
  try {
    for (const pattern of E2E_FIXTURE_PATTERNS) {
      const rows = await matchRows(client, pattern);
      const verb = { soft: 'soft-delete', hard: 'DELETE', deactivate: 'deactivate' }[
        pattern.action
      ];
      console.log(`${pattern.table}: ${verb} ${rows.length} row(s)`);
      if (rows.length) console.log(`  (${pattern.note})`);
      for (const row of rows) console.log(`  ${row.id}  ${row.label}`);
      if (pattern.table === 'Role') await reportHeldRoles(client);
      if (APPLY && rows.length) {
        const changed = await applyPattern(client, pattern);
        console.log(`  applied to ${changed} row(s)`);
      }
      total += rows.length;
      console.log('');
    }

    total += await handleContactEmail(client);
    console.log('');
  } finally {
    await client.end();
  }

  console.log(`[${CONTEXT}] ${total} row(s) ${APPLY ? 'changed' : 'pending'}`);
  if (APPLY && total > 0) {
    console.log(
      `[${CONTEXT}] flush the Redis for this stack now: shipping rate calculation caches ` +
        'zone and method reads for 15 minutes and a direct database write does not ' +
        'invalidate it. `docker exec merchants-engine-redis-dev redis-cli FLUSHDB`',
    );
  }
  if (!APPLY && total > 0) {
    console.log(`[${CONTEXT}] re-run with --apply once the rows above look right.`);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
