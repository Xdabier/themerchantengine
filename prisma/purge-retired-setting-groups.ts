/**
 * Idempotent StoreSetting cleanup, run by `prisma/seed.ts` on both the dev seed
 * path and the `SEED_SCOPE=notifications-rbac` prod deploy path, and by
 * `prisma/seed-roles-only.ts`.
 *
 * DR-35 removed the license module and its `license` settings group. A database
 * seeded before that still holds the rows the verdict cache wrote. Nothing reads
 * them any more, and the settings API now rejects the group as unknown, so they
 * are dead weight that an operator can neither see nor remove.
 *
 * Deliberately bounded, like `reconcile-role-permissions.ts`: it deletes only
 * the groups named below, never "every group the API does not know". Each row
 * is logged before the delete, and the audit entry keeps group, key and value,
 * because the deploy log is not persisted and is no restore list on its own.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export const RETIRED_SETTING_GROUPS = ['license'] as const;

export interface PurgeResult {
  removed: Array<{ group: string; key: string; value: Prisma.JsonValue }>;
}

export async function purgeRetiredSettingGroups(
  client: PrismaClient,
  log: (message: string) => void = console.log,
): Promise<PurgeResult> {
  const where = { group: { in: [...RETIRED_SETTING_GROUPS] } };
  const doomed = await client.storeSetting.findMany({
    where,
    select: { group: true, key: true, value: true },
    orderBy: [{ group: 'asc' }, { key: 'asc' }],
  });

  if (doomed.length === 0) {
    log('  setting-purge: no retired setting rows');
    return { removed: [] };
  }

  for (const row of doomed) {
    log(`  setting-purge: removing ${row.group}.${JSON.stringify(row.key)}`);
  }
  log(`  setting-purge-restore-json: ${JSON.stringify(doomed)}`);

  // The audit row is the only durable restore list, so it and the delete land
  // together or not at all. A failure keeps the rows for the next run and never
  // fails the deploy.
  try {
    const [, result] = await client.$transaction([
      client.auditLogEntry.create({
        data: {
          userId: null,
          action: 'store_setting.purge_retired',
          entityType: 'store_setting',
          entityId: null,
          changes: { before: { settings: doomed }, after: { settings: [] } },
          ipAddress: null,
          userAgent: 'prisma/seed purgeRetiredSettingGroups',
        },
      }),
      client.storeSetting.deleteMany({ where }),
    ]);
    log(`  setting-purge: removed ${result.count} retired setting row(s), audit entry written`);
    return { removed: doomed };
  } catch (err) {
    log(
      `  setting-purge: WARNING nothing removed, could not write the audit entry: ${String(err)}`,
    );
    return { removed: [] };
  }
}
