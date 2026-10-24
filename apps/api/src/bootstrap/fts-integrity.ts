import { isProduction } from '@common/env';
import { registryLocaleCodes } from '@common/locale';

/**
 * Boot tripwire for the half-applied full-text-search state.
 *
 * Authority: `specs/features/storefront-qa-remediation/plan-k-storefront-data-hygiene.md`
 * Phase K7 (pass-2 findings C9 and AD1), `specs/decision-records/19-raw-sql-search-fts.md`.
 *
 * THE BUG THIS CATCHES. `Product."searchVector"`, its trigger and its indexes
 * live in `prisma/search_fts_setup.sql`, not in `schema.prisma`. A bare
 * `prisma db push` therefore DROPS the column and leaves the trigger
 * `product_search_vector_trig` attached to `Product`. From that moment the
 * trigger body assigns to a column that no longer exists, so search returns
 * nothing AND every product create or text edit throws a 500. The database
 * looks healthy; only the writes fail. That is what broke the dev database
 * during the 2026-08-27 QA pass, and it had broken it before.
 *
 * The repair is always the same: `npm run db:fts`.
 *
 * WHY A BOOT CHECK AND NOT ONLY SCRIPT GUARDS. Phase K7 also chains `db:fts`
 * onto `npm run db:push`, and the install stepper re-applies it after its own
 * push, which closes the paths we know about. This closes the ones we do not: a hand-run `npx prisma db push`,
 * a restored dump, a colleague's shell. It runs on dev and test only. Prod
 * applies the same SQL as the superuser through the pg container (see the
 * header of `prisma/apply-fts-setup.ts`), so prod must never refuse to boot
 * over a repair it cannot run itself.
 *
 * THE FOUR STATES.
 *   trigger + column   healthy, the normal state after `db:fts`
 *   neither            healthy, a fresh database before `db:setup` has run
 *   trigger, no column BROKEN, refuse to boot and name the repair
 *   column, no trigger stale but harmless (writes succeed, vectors go stale),
 *                      so it warns rather than refuses
 *
 * A fifth, softer check covers a registry locale added after the SQL was last
 * applied: it is absent from the trigger function, so its
 * names are never indexed (its `NEW.name->>'<code>'` segment is absent). That
 * also only warns.
 *
 * WHY IT LIVES HERE AND NOT IN `prisma/`. `apps/api/tsconfig.app.json` includes
 * only `src/**`, `scripts/**` and the shared lib, so importing a `prisma/*`
 * module from `main.ts` breaks `nx build api`.
 */

export const FTS_TRIGGER_NAME = 'product_search_vector_trig';
export const FTS_FUNCTION_NAME = 'product_search_vector_update';
export const FTS_COLUMN_NAME = 'searchVector';
export const FTS_REPAIR_COMMAND = 'npm run db:fts';

export interface FtsProbe {
  hasTrigger: boolean;
  hasColumn: boolean;
  /** Registry locale codes the applied trigger function does not index. */
  missingLocales?: string[];
}

export interface FtsVerdict {
  ok: boolean;
  /** Set whenever the state is anything other than plainly healthy. */
  message?: string;
}

/** Pure decision, so the rule is testable without a database. */
export function evaluateFtsIntegrity(probe: FtsProbe): FtsVerdict {
  if (probe.hasTrigger && !probe.hasColumn) {
    return {
      ok: false,
      message:
        `[fts-integrity] BROKEN full-text search state: the trigger "${FTS_TRIGGER_NAME}" is attached ` +
        `to "Product" but the column "${FTS_COLUMN_NAME}" is missing. A bare \`prisma db push\` drops ` +
        `the column and leaves the trigger, which makes search return nothing and every product create ` +
        `or text edit fail with a 500.\n` +
        `[fts-integrity] Repair: ${FTS_REPAIR_COMMAND}`,
    };
  }
  if (probe.hasColumn && !probe.hasTrigger) {
    return {
      ok: true,
      message:
        `[fts-integrity] warning: the column "${FTS_COLUMN_NAME}" exists but the trigger ` +
        `"${FTS_TRIGGER_NAME}" is not attached, so search vectors go stale on every write. ` +
        `Repair: ${FTS_REPAIR_COMMAND}`,
    };
  }
  if (probe.missingLocales?.length) {
    return {
      ok: true,
      message:
        `[fts-integrity] warning: the applied search trigger does not index the registry ` +
        `locale(s) ${probe.missingLocales.join(', ')}, so their text is not searchable. Repair: npm run db:fts:generate, then ${FTS_REPAIR_COMMAND}`,
    };
  }
  return { ok: true };
}

/**
 * Runs the catalogue lookups. All are read-only `information_schema` or
 * `pg_proc` queries with bound parameters, which is why raw SQL is acceptable here under
 * constitution §3.5; the FTS objects are outside the Prisma schema by design
 * (DR-19), so there is no typed client path to them.
 */
export type FtsQuery = (sql: string, ...params: unknown[]) => Promise<unknown[]>;

export async function probeFtsIntegrity(query: FtsQuery): Promise<FtsProbe> {
  const trigger = await query(
    `SELECT 1 FROM information_schema.triggers
      WHERE event_object_table = 'Product' AND trigger_name = $1 LIMIT 1`,
    FTS_TRIGGER_NAME,
  );
  const column = await query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'Product' AND column_name = $1 LIMIT 1`,
    FTS_COLUMN_NAME,
  );
  const missingLocales = column.length > 0 ? await probeMissingLocales(query) : [];
  return { hasTrigger: trigger.length > 0, hasColumn: column.length > 0, missingLocales };
}

/** Each registry locale gets its own `NEW.name->>'<code>'` segment in the generated function. */
async function probeMissingLocales(query: FtsQuery): Promise<string[]> {
  const rows = (await query(
    `SELECT prosrc FROM pg_proc WHERE proname = $1 LIMIT 1`,
    FTS_FUNCTION_NAME,
  )) as Array<{ prosrc?: string }>;
  const source = rows[0]?.prosrc;
  if (!source) return [];
  return registryLocaleCodes().filter((code) => !source.includes(`NEW.name->>'${code}'`));
}

/** Environments where the check runs. Prod is deliberately excluded. */
export function ftsCheckApplies(nodeEnv: string | undefined): boolean {
  return !isProduction({ NODE_ENV: nodeEnv });
}

/**
 * Throws on the broken state so the API refuses to boot with a name for the
 * repair. A failing probe (no database yet, permissions) is NOT fatal: the API
 * has its own database wiring and error reporting, and this guard must never
 * become the reason an unrelated boot fails.
 */
export async function assertFtsIntegrity(
  query: FtsQuery,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Promise<void> {
  if (!ftsCheckApplies(nodeEnv)) return;

  let verdict: FtsVerdict;
  try {
    verdict = evaluateFtsIntegrity(await probeFtsIntegrity(query));
  } catch {
    return;
  }

  if (!verdict.ok) throw new Error(verdict.message);
  // eslint-disable-next-line no-console
  if (verdict.message) console.warn(verdict.message);
}
