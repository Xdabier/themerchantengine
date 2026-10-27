/**
 * Roles and permissions only. No users, no catalogue, no demo data.
 *
 * `prisma db seed` plants the full demo tree (10 products, 7 users with known
 * passwords, 4 orders) on every run that is not the prod-safe scope, so it is
 * the wrong tool for a greenfield production database. The
 * provisioning runbook works around that by seeding everything and then
 * scrambling the demo accounts afterwards, which leaves the demo catalogue
 * behind as clutter in a brand-new store.
 *
 * `SEED_SCOPE=notifications-rbac` is not the answer either: its permission sync
 * is deliberately additive over EXISTING roles, so on an empty database it logs
 * `role "Super Admin" absent — skipped` and grants nothing.
 *
 * This script is the missing middle: create the four roles with their grants,
 * then reconcile. Idempotent — the upserts use `update: {}` so an existing
 * database keeps whatever grants it already had, and the sync only ever adds.
 *
 * Run it against the target stack, then create the first real administrator
 * with `apps/api/scripts/create-admin.ts`.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Same self-contained copy the main seed uses: the slim prod runtime image does
// not ship libs/shared/permissions. Parity is guarded by
// apps/api/src/permission-catalogue.parity.spec.ts.
import { PERMISSION_STRINGS, type Permission } from './permission-catalogue';
import { reconcileRolePermissions } from './reconcile-role-permissions';
import { purgeRetiredSettingGroups } from './purge-retired-setting-groups';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const ALL_PERMISSIONS: Permission[] = [...PERMISSION_STRINGS];
const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== 'admin_users:manage');

const MANAGER_MODULES = [
  'products',
  'categories',
  'inventory',
  'orders',
  'promotions',
  'assets',
  'shipping',
];
const MANAGER_PERMISSIONS = ALL_PERMISSIONS.filter((p) =>
  MANAGER_MODULES.some((mod) => p.startsWith(`${mod}:`)),
);

const SUPPORT_PERMISSIONS: Permission[] = [
  'orders:view',
  'orders:update',
  'returns:view',
  'returns:create',
  'returns:update',
  'customers:view',
  'customers:update',
  'reviews:view',
  'reviews:update',
  'products:view',
  'inventory:view',
  'shipping:view',
];

const ROLES: Array<{ name: string; description: string; permissions: Permission[] }> = [
  {
    name: 'Super Admin',
    description: 'Full system access — all permissions',
    permissions: ALL_PERMISSIONS,
  },
  {
    name: 'Admin',
    description: 'Broad admin access — all except admin_users:manage',
    permissions: ADMIN_PERMISSIONS,
  },
  {
    name: 'Manager',
    description: 'Manages products, inventory, orders, and promotions',
    permissions: MANAGER_PERMISSIONS,
  },
  {
    name: 'Support',
    description: 'Customer support — read-only on most, write on orders/returns/customers',
    permissions: SUPPORT_PERMISSIONS,
  },
];

async function main(): Promise<void> {
  console.log('Seeding roles and permissions only ...');

  for (const spec of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: spec.name },
      update: {},
      create: { name: spec.name, description: spec.description },
    });

    // Separate from the upsert on purpose. `update: {}` means an existing role
    // never receives grants added by a later permission module, which is the
    // exact drift the additive sync exists to close.
    const added = await prisma.rolePermission.createMany({
      data: spec.permissions.map((permission) => ({ roleId: role.id, permission })),
      skipDuplicates: true,
    });

    console.log(`  ${spec.name}: +${added.count} permission(s)`);
  }

  await reconcileRolePermissions(prisma);
  await purgeRetiredSettingGroups(prisma);

  const users = await prisma.user.count();
  console.log(`\nRoles seeded. Users in this database: ${users}.`);
  if (users === 0) {
    console.log('Next: npx ts-node apps/api/scripts/create-admin.ts');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
