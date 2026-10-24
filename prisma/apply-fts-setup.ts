/**
 * Applies `prisma/search_fts_setup.sql` against `$DATABASE_URL` for the
 * DEV + TEST environments (npm `db:fts`, the e2e global setup). The connection
 * here owns the FTS objects (dev/test superuser = `postgres`), so
 * `CREATE EXTENSION` / `CREATE OR REPLACE FUNCTION` succeed.
 *
 * PROD does NOT use this applier: the API container connects as the unprivileged
 * `merchants_app` role, which can neither create extensions nor replace a
 * function owned by `postgres` (error 42501 "must be owner of function"). The
 * install stepper's schema step therefore applies the same SQL as the
 * superuser through the postgres container:
 * `docker exec -i <postgres> psql -U postgres -d merchants_engine
 *  -v ON_ERROR_STOP=1 -f - < prisma/search_fts_setup.sql`.
 *
 * WHY any of this exists: the FTS index (`Product."searchVector"` column, the
 * pg_trgm/unaccent extensions, the maintenance trigger, the GIN/trigram indexes,
 * the backfill) is NOT in `schema.prisma`, so every `prisma db push
 * --accept-data-loss` can drop the column and bulk imports never re-fire the
 * backfill — which left 601/760 products with a NULL vector and unsearchable.
 * The SQL must be re-applied after every `db push` and every bulk import.
 *
 * The SQL is idempotent (CREATE … IF NOT EXISTS / CREATE OR REPLACE / DROP …
 * IF EXISTS) and ends with a guard that RAISEs if any active product still has
 * a NULL vector. Uses the `pg` client directly (available via @prisma/adapter-pg)
 * because the file is multi-statement with `$$`-quoted PL/pgSQL bodies the
 * prepared-statement path cannot run.
 *
 * Authority: specs/features/storefront-search-restore/plan.md §2.1,
 * specs/decision-records/19-raw-sql-search-fts.md.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const SQL_PATH = path.resolve(__dirname, 'search_fts_setup.sql');

export async function applyFtsSetup(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  if (!databaseUrl) {
    throw new Error('[db:fts] DATABASE_URL is not set');
  }
  if (!fs.existsSync(SQL_PATH)) {
    throw new Error(`[db:fts] FTS SQL not found at ${SQL_PATH}`);
  }
  const sql = fs.readFileSync(SQL_PATH, 'utf8');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // eslint-disable-next-line no-console
    console.log(`[db:fts] applying ${SQL_PATH}`);
    // Runs every statement (incl. $$-quoted bodies + the terminal NULL-vector
    // guard) as one implicit transaction. With the NULL-safe trigger a valid
    // catalogue never trips the guard; if it ever does, the whole apply rejects
    // here so the failure is loud.
    await client.query(sql);
    // eslint-disable-next-line no-console
    console.log('[db:fts] OK — searchVector built + backfilled for all active products');
  } finally {
    await client.end();
  }
}

// Allow standalone invocation: `npx ts-node prisma/apply-fts-setup.ts`.
if (require.main === module) {
  applyFtsSetup().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[db:fts] failed:', err);
    process.exit(1);
  });
}
