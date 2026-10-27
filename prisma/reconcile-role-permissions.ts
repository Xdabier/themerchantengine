/**
 * One-time-but-idempotent RolePermission cleanup, run by `prisma/seed.ts` on
 * both the dev seed path and the `SEED_SCOPE=notifications-rbac` prod deploy
 * path.
 *
 * History: the seed used to grant a 16-entry "admin dashboard" permission list
 * on top of the real module list. Ten of those module keys were enforced by
 * exactly zero endpoints: three hyphenated twins of real modules plus seven
 * invented ones. The roles grid painted the union of persisted grants, so an
 * operator could tick `gift-cards:view`, believe gift-card access was granted,
 * and get nothing. DR-35 then removed the license module, so its `license:*`
 * grants joined the dead list as an eleventh family.
 *
 * Deliberately a bounded delete. It removes only the eleven historical dead
 * families, never "everything outside the catalogue". The complement form would
 * be self-healing but unbounded: the moment `prisma/permission-catalogue.ts`
 * (a hand-maintained copy) fell behind `libs/shared/permissions`, a deploy
 * would silently delete live grants for a real, enforced module. Nothing can
 * write new junk any more (the seed derives from the catalogue and the admin
 * DTOs validate membership), so a bounded delete loses nothing real. Anything
 * unexpected is reported, not deleted.
 *
 * Kept in its own file rather than inline in `seed.ts` so it can be imported by
 * tests, the same way `prisma/apply-fts-setup.ts` is.
 */
import type { PrismaClient } from '@prisma/client';
import { PERMISSION_ACTIONS, PERMISSION_MODULES, PERMISSION_STRINGS } from './permission-catalogue';

/** Legacy hyphenated spellings of modules that really exist. */
export const PERMISSION_TWINS: Record<string, string> = {
  'audit-logs': 'audit_log',
  'gift-cards': 'gift_cards',
  'payment-methods': 'payment_methods',
};

/**
 * Every module key the seed used to grant that no endpoint has ever checked.
 * The concept each one expressed, where it exists at all, lives under a
 * canonical key: `currencies` / `tax` -> `settings`, `refunds` -> `returns`,
 * `staff` / `roles` / `rbac` -> `admin_users`, `users` -> `customers`.
 * Those seven are NOT auto-mapped: `settings:view` and `admin_users:view` gate
 * far more than the operator originally ticked, so mapping them would be a
 * privilege escalation. Only the three punctuation twins are carried over.
 * `license` was a real module until DR-35 removed it; it has no successor.
 */
export const DEAD_PERMISSION_MODULES = [
  'audit-logs',
  'currencies',
  'gift-cards',
  'license',
  'payment-methods',
  'rbac',
  'refunds',
  'roles',
  'staff',
  'tax',
  'users',
] as const;

/**
 * Refuses to run against a malformed catalogue. Cheap, but it is the guard that
 * stands between a bad import and a destructive statement on production, and
 * the CI unit-test job that would otherwise catch it is currently disabled.
 */
export function assertCatalogueIntegrity(): void {
  const expected = PERMISSION_MODULES.length * PERMISSION_ACTIONS.length;
  if (PERMISSION_STRINGS.length !== expected || expected === 0) {
    throw new Error(
      `[perm-reconcile] refusing to run: catalogue is ${PERMISSION_STRINGS.length} strings, expected ${expected}`,
    );
  }
  for (const canonical of Object.values(PERMISSION_TWINS)) {
    if (!PERMISSION_MODULES.includes(canonical as (typeof PERMISSION_MODULES)[number])) {
      throw new Error(
        `[perm-reconcile] refusing to run: twin target "${canonical}" is not a module`,
      );
    }
  }
  for (const dead of DEAD_PERMISSION_MODULES) {
    if (PERMISSION_MODULES.includes(dead as unknown as (typeof PERMISSION_MODULES)[number])) {
      throw new Error(`[perm-reconcile] refusing to run: "${dead}" is both dead and canonical`);
    }
  }
}

const deadPermissionStrings = (): string[] =>
  DEAD_PERMISSION_MODULES.flatMap((mod) => PERMISSION_ACTIONS.map((action) => `${mod}:${action}`));

export interface ReconcileResult {
  granted: Array<{ role: string; permission: string }>;
  removed: Array<{ role: string; permission: string }>;
  unexpected: Array<{ role: string; permission: string }>;
}

export async function reconcileRolePermissions(
  client: PrismaClient,
  log: (message: string) => void = console.log,
): Promise<ReconcileResult> {
  assertCatalogueIntegrity();

  const catalogue = new Set<string>(PERMISSION_STRINGS);
  const dead = deadPermissionStrings();

  // ── Step 1: canonicalize twins BEFORE anything is deleted ─────────────────
  // A role holding only `gift-cards:view` expressed a real intent; give it the
  // canonical grant first so the prune cannot lose it.
  const twinRows = await client.rolePermission.findMany({
    where: {
      OR: Object.keys(PERMISSION_TWINS).map((prefix) => ({
        permission: { startsWith: `${prefix}:` },
      })),
    },
    select: { permission: true, roleId: true, role: { select: { name: true } } },
  });

  const grants = new Map<string, { roleId: string; permission: string; role: string }>();
  for (const row of twinRows) {
    const [module, action] = row.permission.split(':');
    const canonical = `${PERMISSION_TWINS[module]}:${action}`;
    if (!catalogue.has(canonical)) continue;
    grants.set(`${row.roleId}:${canonical}`, {
      roleId: row.roleId,
      permission: canonical,
      role: row.role.name,
    });
  }

  const granted: Array<{ role: string; permission: string }> = [];
  if (grants.size > 0) {
    // Itemised, not just counted: this is the only step that can ADD access on
    // production, so it must be at least as legible in the deploy log as the
    // step that removes it.
    for (const g of grants.values()) {
      // Role names are operator-controlled and unrestricted in charset, so a
      // newline in one could forge extra log lines in the forensic record.
      log(`  perm-reconcile: granting canonical ${JSON.stringify(g.role)} -> ${g.permission}`);
      granted.push({ role: g.role, permission: g.permission });
    }
    const created = await client.rolePermission.createMany({
      data: [...grants.values()].map((g) => ({ roleId: g.roleId, permission: g.permission })),
      skipDuplicates: true,
    });
    log(`  perm-reconcile: canonicalized twins -> +${created.count} new grant(s)`);
  }

  // ── Step 2: bounded prune of the eleven historical dead families ──────────
  const doomed = await client.rolePermission.findMany({
    where: { permission: { in: dead } },
    select: { permission: true, role: { select: { name: true } } },
    orderBy: [{ roleId: 'asc' }, { permission: 'asc' }],
  });

  const removed = doomed.map((row) => ({ role: row.role.name, permission: row.permission }));
  if (removed.length === 0) {
    log('  perm-reconcile: no dead permission grants');
  } else {
    for (const row of removed) {
      log(`  perm-reconcile: removing ${JSON.stringify(row.role)} -> ${row.permission}`);
    }
    // One machine-readable line as well, so a truncated CI log still yields a
    // replayable restore list.
    log(`  perm-reconcile-restore-json: ${JSON.stringify(removed)}`);
    const result = await client.rolePermission.deleteMany({
      where: { permission: { in: dead } },
    });
    log(`  perm-reconcile: removed ${result.count} dead grant(s)`);
  }

  // ── Step 3: report anything else outside the catalogue, never delete it ───
  const strays = await client.rolePermission.findMany({
    where: { NOT: { permission: { in: [...PERMISSION_STRINGS] } } },
    select: { permission: true, role: { select: { name: true } } },
  });

  const unexpected = strays.map((row) => ({ role: row.role.name, permission: row.permission }));
  for (const row of unexpected) {
    log(
      `  perm-reconcile: WARNING unknown grant left in place: ${JSON.stringify(row.role)} -> ${row.permission}`,
    );
  }

  await recordAudit(client, { granted, removed, unexpected }, log);

  return { granted, removed, unexpected };
}

/**
 * Durable record of a bulk RBAC change. Every operator-initiated role edit is
 * already audited by the global AuditLogInterceptor; this reconcile makes the
 * same class of change on live data, so it should not be traceable only through
 * an expiring CI job log. `userId: null` is the system actor, matching the
 * column's documented convention.
 *
 * Never fatal: losing the audit row must not fail a deploy whose data change
 * already succeeded. A write failure is logged loudly instead.
 */
async function recordAudit(
  client: PrismaClient,
  result: ReconcileResult,
  log: (message: string) => void,
): Promise<void> {
  if (result.granted.length === 0 && result.removed.length === 0) return;
  try {
    await client.auditLogEntry.create({
      data: {
        userId: null,
        action: 'role_permission.reconcile',
        entityType: 'role_permission',
        entityId: null,
        changes: {
          before: { grants: result.removed },
          after: { grants: result.granted },
          unexpected: result.unexpected,
        },
        ipAddress: null,
        userAgent: 'prisma/seed reconcileRolePermissions',
      },
    });
    log('  perm-reconcile: audit entry written (role_permission.reconcile)');
  } catch (err) {
    log(`  perm-reconcile: WARNING could not write the audit entry: ${String(err)}`);
  }
}
