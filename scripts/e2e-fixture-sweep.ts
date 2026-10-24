/**
 * The sweep itself: turn `E2E_FIXTURE_PATTERNS` into SQL and run it.
 *
 * Plan H, phases H1 and H2. Two callers share this so they can never disagree
 * about what a fixture row is:
 *   - `cleanup-e2e-fixtures.ts`, the reviewed one-shot dev repair;
 *   - `apps/admin-e2e/global-teardown.ts`, which runs unattended against the
 *     TEST database after every suite.
 *
 * The specs clean up after themselves where they can, and after phase H2 that
 * covers everything except the two tables with no DELETE endpoint at all
 * (shipping zones and tax zones). This is the backstop for the run that was
 * interrupted, crashed, or whose cleanup silently 4xx'd, which is exactly how
 * rows that a `try/finally` was supposed to remove ended up in the dev
 * database anyway.
 */

import { Client } from 'pg';
import {
  E2E_FIXTURE_PATTERNS,
  assertTestDatabase,
  type FixturePattern,
} from './e2e-fixture-patterns';

export interface MatchedRow {
  id: string;
  label: string;
}

/**
 * The predicate for rows this pattern still has work to do on.
 *
 * Each action needs its own "already done" clause, or a second run reports the
 * same rows forever and the idempotency proof the protocol demands is
 * impossible to obtain.
 */
export function pendingPredicate(pattern: FixturePattern): string {
  if (pattern.action === 'soft') return `"deletedAt" IS NULL AND (${pattern.where})`;
  if (pattern.action === 'deactivate') return `"isActive" = true AND (${pattern.where})`;
  return pattern.where;
}

export async function matchRows(client: Client, pattern: FixturePattern): Promise<MatchedRow[]> {
  const { rows } = await client.query<MatchedRow>(
    `SELECT id::text AS id, (${pattern.label})::text AS label
       FROM "${pattern.table}"
      WHERE ${pendingPredicate(pattern)}
      ORDER BY label`,
  );
  return rows;
}

export async function applyPattern(client: Client, pattern: FixturePattern): Promise<number> {
  const where = pendingPredicate(pattern);
  if (pattern.action === 'hard') {
    const res = await client.query(`DELETE FROM "${pattern.table}" WHERE ${where}`);
    return res.rowCount ?? 0;
  }
  const sets = [pattern.action === 'soft' ? `"deletedAt" = now()` : undefined, pattern.alsoSet]
    .filter(Boolean)
    .join(', ');
  const res = await client.query(`UPDATE "${pattern.table}" SET ${sets} WHERE ${where}`);
  return res.rowCount ?? 0;
}

/**
 * Sweep the TEST database. Refuses anything else.
 *
 * Called from a global teardown, so it never throws: a suite that passed must
 * not be turned red by its own housekeeping. The wrong-database case is the
 * one exception worth surfacing, and even that is reported rather than thrown,
 * because by teardown time the writes have already happened and failing the
 * run would only hide them behind a second error.
 */
export async function sweepTestFixtures(
  databaseUrl: string | undefined,
  log: (message: string) => void = () => undefined,
): Promise<number> {
  let database: string;
  try {
    database = assertTestDatabase(databaseUrl, 'e2e-teardown');
  } catch (err) {
    log(`[e2e-teardown] sweep skipped: ${(err as Error).message}`);
    return 0;
  }

  const client = new Client({ connectionString: databaseUrl });
  let swept = 0;
  try {
    await client.connect();
    for (const pattern of E2E_FIXTURE_PATTERNS) {
      swept += await applyPattern(client, pattern);
    }
    if (swept > 0) log(`[e2e-teardown] swept ${swept} leftover fixture row(s) from ${database}`);
  } catch (err) {
    log(`[e2e-teardown] sweep failed (non-fatal): ${(err as Error).message}`);
  } finally {
    await client.end().catch(() => undefined);
  }
  return swept;
}
