/**
 * Idempotent backfill of NotificationTemplate fr/en bodies + variables from the
 * canonical `TEMPLATE_DEFAULTS` (NE3).
 *
 * WHY this is a script, not a `migration.sql`: the bodies are 36 × 2 multi-line
 * HTML documents, and embedding them as SQL string literals is unmaintainable
 * and drift-prone. The canonical copy lives in TS (`notification-template-defaults.ts`),
 * so the backfill reads it directly. Mirrors the `apply-fts-setup.ts` precedent
 * (a standalone ts-node script the CI migrate step + provisioning invoke).
 *
 * SAFETY (Risk R1 — never clobber an operator edit): a body locale is filled
 * ONLY when it is currently empty/missing; a non-empty locale is left exactly as
 * the operator saved it. `variables` is filled ONLY when the row's array is
 * empty. Both conditions make a re-run a no-op, so the script is safe to run on
 * every deploy. Per-locale: an empty `fr` next to an operator-edited `en` fills
 * `fr` only.
 *
 * Rollback: the backfill only writes into empty fields, so it adds no data an
 * operator authored. To revert, clear the affected `body`/`variables` back to
 * empty — there is no destructive overwrite to undo.
 *
 * Invoke: `npx ts-node prisma/backfill-notification-bodies.ts` (or
 * `npm run db:backfill-templates`). Applied to dev/test during NE3; the prod
 * run happens post-`migrate deploy`.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { registryLocaleCodes } from '../libs/shared/common/src/locale/locale-registry';
import {
  TEMPLATE_DEFAULTS,
  type MailFlowCode,
  type NotificationTemplateDefault,
} from './notification-template-defaults';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export interface TemplateRow {
  id: string;
  code: string;
  body: unknown;
  variables: string[];
}

export interface BackfillPatch {
  body?: Record<string, string>;
  variables?: string[];
}

/**
 * Pure planner: returns the minimal update payload for one row, or `null` when
 * the row already satisfies the defaults (so nothing should be written).
 */
export function planBackfill(
  row: Pick<TemplateRow, 'body' | 'variables'>,
  def: NotificationTemplateDefault | undefined,
): BackfillPatch | null {
  if (!def) return null; // a row whose code has no default (e.g. a removed flow) is skipped.

  const patch: BackfillPatch = {};

  const current: Record<string, string> =
    row.body && typeof row.body === 'object' ? { ...(row.body as Record<string, string>) } : {};
  let bodyChanged = false;
  for (const locale of registryLocaleCodes()) {
    const value = typeof current[locale] === 'string' ? current[locale] : '';
    if (value.trim() === '') {
      current[locale] = def.body[locale];
      bodyChanged = true;
    }
  }
  if (bodyChanged) patch.body = current;

  if (!Array.isArray(row.variables) || row.variables.length === 0) {
    patch.variables = def.variables;
  }

  return patch.body || patch.variables ? patch : null;
}

interface BackfillPrisma {
  notificationTemplate: {
    findMany(args: {
      select: { id: true; code: true; body: true; variables: true };
    }): Promise<TemplateRow[]>;
    update(args: { where: { id: string }; data: BackfillPatch }): Promise<unknown>;
  };
}

export interface BackfillResult {
  total: number;
  updated: number;
  skipped: number;
}

/**
 * Apply the backfill across every NotificationTemplate row. Idempotent.
 */
export async function backfillNotificationBodies(prisma: BackfillPrisma): Promise<BackfillResult> {
  const rows = await prisma.notificationTemplate.findMany({
    select: { id: true, code: true, body: true, variables: true },
  });

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const def = TEMPLATE_DEFAULTS[row.code as MailFlowCode];
    const patch = planBackfill(row, def);
    if (!patch) {
      skipped += 1;
      continue;
    }
    await prisma.notificationTemplate.update({ where: { id: row.id }, data: patch });
    updated += 1;
  }
  return { total: rows.length, updated, skipped };
}

/**
 * Open a Prisma client against `databaseUrl` and run the backfill. Mirrors
 * `apply-fts-setup.ts`'s `applyFtsSetup(databaseUrl)` so the same entry serves
 * the CLI, the e2e global setup, and CI/provisioning.
 */
export async function applyTemplateBackfill(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<BackfillResult> {
  if (!databaseUrl) throw new Error('[backfill-templates] DATABASE_URL is not set');
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const adapter = new PrismaPg(databaseUrl);
  const prisma = new PrismaClient({ adapter });
  try {
    return await backfillNotificationBodies(prisma as unknown as BackfillPrisma);
  } finally {
    await prisma.$disconnect();
  }
}

// Standalone invocation only. Guarded so importing this module (e.g. from a
// spec) never runs the CLI; the `typeof require` check stays safe under an ESM
// test runner where `require` is absent.
if (typeof require !== 'undefined' && require.main === module) {
  applyTemplateBackfill()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(
        `[backfill-templates] ${result.updated} filled, ${result.skipped} unchanged, ${result.total} total`,
      );
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[backfill-templates] failed:', err);
      process.exit(1);
    });
}
