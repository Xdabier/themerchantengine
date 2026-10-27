/**
 * License row cleanup (e2e), plan OR6 (DR-35).
 *
 * The license module and its permission key are gone, but a database seeded
 * before DR-35 still holds `license:*` grants and `license` store settings.
 * A role with a leftover grant could not be saved from `/roles`: reading it and
 * PATCHing its own list back 400s, because the DTO rejects a key outside the
 * catalogue. The seed-time cleanup must remove both kinds of row so that round
 * trip returns 200, and must leave a durable record a rollback can replay.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PERMISSION_ACTIONS } from '../../prisma/permission-catalogue';
import { reconcileRolePermissions } from '../../prisma/reconcile-role-permissions';
import { purgeRetiredSettingGroups } from '../../prisma/purge-retired-setting-groups';
import { api, loginAs, createTestPrisma, ADMIN } from './helpers';

const PREFIX = 'license-cleanup-';
const MIGRATION_SQL = join(
  __dirname,
  '../../prisma/migrations/20261027120000_drop_license_rows/migration.sql',
);

/** The two INSERT statements of the ROLLBACK note, with the comment prefix stripped. */
function rollbackStatements(): string[] {
  const commented = readFileSync(MIGRATION_SQL, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('--'))
    .map((line) => line.replace(/^--\s?/, ''))
    .join('\n');
  const statements = commented.match(/INSERT INTO[\s\S]*?ON CONFLICT DO NOTHING;/g) ?? [];
  expect(statements).toHaveLength(2);
  return statements;
}

function withAuditId(statement: string, auditId: string): string {
  expect(auditId).toMatch(/^[A-Za-z0-9-]+$/);
  expect(statement).toContain(`'<audit entry id>'`);
  return statement.replace(`'<audit entry id>'`, `'${auditId}'`);
}

describe('License row cleanup (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  const stamp = Date.now();
  const roleName = `${PREFIX}${stamp}`;
  const nearMissRoleName = `${PREFIX}near-miss-${stamp}`;
  const settingKey = `${PREFIX}${stamp}`;
  const settingValue = { status: 'valid', checkedAt: '2026-01-01T00:00:00.000Z' };

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  }, 30_000);

  afterAll(async () => {
    await prisma.role
      .deleteMany({ where: { name: { startsWith: PREFIX } } })
      .catch(() => undefined);
    await prisma.storeSetting
      .deleteMany({ where: { key: { startsWith: PREFIX } } })
      .catch(() => undefined);
    await prisma.$disconnect();
  });

  it('removes every leftover license grant and setting, then the role saves with 200', async () => {
    const role = await prisma.role.create({
      data: {
        name: roleName,
        description: 'Pre-DR-35 role with license grants',
        permissions: {
          create: [
            { permission: 'orders:view' },
            ...PERMISSION_ACTIONS.map((action) => ({ permission: `license:${action}` })),
          ],
        },
      },
    });
    await prisma.storeSetting.create({
      data: { group: 'license', key: settingKey, value: settingValue },
    });

    await reconcileRolePermissions(prisma, () => undefined);
    await purgeRetiredSettingGroups(prisma, () => undefined);

    const grants = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    expect(grants.map((g) => g.permission).sort()).toEqual(['orders:view']);
    expect(
      await prisma.rolePermission.count({ where: { permission: { startsWith: 'license:' } } }),
    ).toBe(0);
    expect(await prisma.storeSetting.count({ where: { group: 'license' } })).toBe(0);

    const list = await api().get('/v1/admin/roles').set('Cookie', adminCookie).expect(200);
    const listed = (
      list.body.data as Array<{ id: string; permissions: Array<{ permission: string }> }>
    ).find((r) => r.id === role.id);
    const permissions = (listed?.permissions ?? []).map((p) => p.permission);
    expect(permissions).toEqual(['orders:view']);

    await api()
      .patch(`/v1/admin/roles/${role.id}`)
      .set('Cookie', adminCookie)
      .send({ permissions })
      .expect(200);
  });

  // The deploy log is not persisted, so the audit entry is the only durable
  // restore list. A setting row cannot be put back without its value.
  it('keeps the removed setting value in the purge audit entry', async () => {
    const key = `${PREFIX}audit-${stamp}`;
    await prisma.storeSetting.create({ data: { group: 'license', key, value: settingValue } });

    await purgeRetiredSettingGroups(prisma, () => undefined);

    const entry = await prisma.auditLogEntry.findFirst({
      where: { action: 'store_setting.purge_retired' },
      orderBy: { createdAt: 'desc' },
    });
    const changes = entry?.changes as {
      before: { settings: Array<{ group: string; key: string; value: unknown }> };
    };
    expect(changes.before.settings).toContainEqual({ group: 'license', key, value: settingValue });
  });

  it('keeps near-miss grants and groups that only look like license', async () => {
    const role = await prisma.role.create({
      data: {
        name: nearMissRoleName,
        description: 'Holds keys that must survive the cleanup',
        permissions: { create: [{ permission: 'orders:view' }, { permission: 'licensing:view' }] },
      },
    });
    await prisma.storeSetting.create({
      data: { group: 'licenses', key: `${PREFIX}near-miss-${stamp}`, value: settingValue },
    });

    await reconcileRolePermissions(prisma, () => undefined);
    await purgeRetiredSettingGroups(prisma, () => undefined);

    const grants = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    expect(grants.map((g) => g.permission).sort()).toEqual(['licensing:view', 'orders:view']);
    expect(
      await prisma.storeSetting.count({
        where: { group: 'licenses', key: `${PREFIX}near-miss-${stamp}` },
      }),
    ).toBe(1);
  });

  // The rollback note is the only restore path, so replay it as written. A
  // statement that cannot run, or that brings back another dead family, reds.
  it('restores license grants and settings by replaying the rollback SQL in the migration', async () => {
    const role = await prisma.role.create({
      data: {
        name: `${PREFIX}rollback-${stamp}`,
        description: 'Restored from the audit entries',
        // `currencies` is dead with no live twin, so step 1 cannot regrant it.
        permissions: {
          create: [{ permission: 'license:view' }, { permission: 'currencies:view' }],
        },
      },
    });
    const key = `${PREFIX}rollback-${stamp}`;
    await prisma.storeSetting.create({ data: { group: 'license', key, value: settingValue } });

    await reconcileRolePermissions(prisma, () => undefined);
    await purgeRetiredSettingGroups(prisma, () => undefined);

    const latestAudit = (action: string) =>
      prisma.auditLogEntry.findFirstOrThrow({ where: { action }, orderBy: { createdAt: 'desc' } });
    const grantsAudit = await latestAudit('role_permission.reconcile');
    const settingsAudit = await latestAudit('store_setting.purge_retired');

    const [restoreGrants, restoreSettings] = rollbackStatements();
    // raw-sql-approved: replays the documented rollback of migration 20261027120000 verbatim; the audit ids come from this test's own rows. Reviewed by schema-migration-reviewer, OR6.
    await prisma.$executeRawUnsafe(withAuditId(restoreGrants, grantsAudit.id));
    // raw-sql-approved: same replay, settings half. Reviewed by schema-migration-reviewer, OR6.
    await prisma.$executeRawUnsafe(withAuditId(restoreSettings, settingsAudit.id));

    const grants = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    expect(grants.map((g) => g.permission)).toEqual(['license:view']);
    const setting = await prisma.storeSetting.findUnique({
      where: { group_key: { group: 'license', key } },
    });
    expect(setting?.value).toEqual(settingValue);

    await reconcileRolePermissions(prisma, () => undefined);
    await purgeRetiredSettingGroups(prisma, () => undefined);
  });

  it('is a no-op on a second run', async () => {
    await purgeRetiredSettingGroups(prisma, () => undefined);
    const auditsBefore = await prisma.auditLogEntry.count({
      where: { action: 'store_setting.purge_retired' },
    });
    const settingsBefore = await prisma.storeSetting.count();
    const grantsBefore = await prisma.rolePermission.count();

    const purge = await purgeRetiredSettingGroups(prisma, () => undefined);
    const reconcile = await reconcileRolePermissions(prisma, () => undefined);

    expect(purge.removed).toEqual([]);
    expect(reconcile.removed).toEqual([]);
    expect(await prisma.storeSetting.count()).toBe(settingsBefore);
    expect(await prisma.rolePermission.count()).toBe(grantsBefore);
    expect(
      await prisma.auditLogEntry.count({ where: { action: 'store_setting.purge_retired' } }),
    ).toBe(auditsBefore);
  });
});
