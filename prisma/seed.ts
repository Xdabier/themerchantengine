import * as path from 'path';
import { SEEDED_ORDER_COUNT, seedOrderNumber } from './order-number';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { Prisma, PrismaClient, type OrderStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
// Self-contained, prod-safe (no apps/api import) — see the file header. NE3:
// fresh DBs get the real en/ar bodies from here instead of empty strings.
import { TEMPLATE_DEFAULTS, type MailFlowCode } from './notification-template-defaults';
import { specKey } from './spec-key';
// Same self-containment rule: a parity-checked copy of `libs/shared/permissions`
// (`@permissions`), which the slim prod runtime image does not ship. Guarded by
// apps/api/src/permission-catalogue.parity.spec.ts.
import { PERMISSION_STRINGS, type Permission } from './permission-catalogue';
import { reconcileRolePermissions } from './reconcile-role-permissions';
import { purgeRetiredSettingGroups } from './purge-retired-setting-groups';
// The seeds that read the runtime store config (DR-31, plan E1.4). Relative
// imports only, for the same reason as above.
import {
  hasDomesticTaxZone,
  seedPaymentMethods,
  seedShipping,
  seedDefaultHomeSections,
  seedTax,
} from './seeds/store-config';
import {
  CURRENCY_ROWS,
  assertFixtureAllowed,
  seedLogoUrl,
  seedStoreConfig,
  seedStoreConfigFixture,
} from './seeds/store-config-fixture';
import {
  STORE_CONFIG_FILE_ENV,
  storeConfigFromEnv,
} from '../libs/shared/common/src/store-config/store-config-file';
import { seedFlatRate } from './seeds/store-config/shipping';
import {
  STORE_CONFIG_FIXTURE_ENV,
  activeStoreConfigFixture,
  runtimeConfigOfFixture,
  type StoreRuntimeConfig,
} from '../libs/shared/common/src/store-config-fixtures';
import {
  isConfiguredStore,
  storeConfigFromSettingRows,
} from '../libs/shared/common/src/store-config/store-config-from-rows';
import { formatMoney } from '../libs/shared/common/src/money/store-money';
// The three value imports above reach into `libs/shared/common/src`, which the
// runtime image ships (apps/api/Dockerfile) and the provisioning script
// bind-mounts, next to this file. Nothing under `prisma/` may value-import
// any other tree; `prisma/__tests__/seed-imports.spec.ts` pins the rule.
import { flushMoneyCache } from './flush-money-cache';

/**
 * The one year the whole seed stamps. Order numbers and the sequence they
 * reserve have to agree on it (finding AD13); the sequence block used to read
 * its own `new Date().getFullYear()` while the order rows carried a literal.
 */
const currentYear = new Date().getFullYear();

/** The databases the destructive demo seed runs on without SEED_DEV_OK=1: the test database only. */
const DEMO_SEED_DATABASES = ['merchants_engine_test'];
// The e2e catalogue seed is imported dynamically inside its opt-in block
// below: a top-level import would force its whole module tree to resolve at
// module-load time (transitive imports reach into apps/api/src, which the
// slim prod runtime image does not include). Dynamic import keeps the prod
// seed flow free of that requirement.

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// ── Permission definitions ────────────────────────────────────────────────────

// The canonical catalogue is the only permission source now. It used to be a
// local 19-module list plus a 16-entry "admin dashboard" list of hyphenated and
// invented keys (`audit-logs`, `rbac`, `tax`, `staff`…) added for an admin guard
// that has long since moved to the canonical underscore keys. Zero endpoints
// ever checked those, so every grant was dead weight the operator could tick.
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

// Typed against the catalogue: a typo here used to be created by the role
// upsert and silently pruned by the reconcile on the same run.
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

/**
 * Ensure a Better Auth `credential` Account exists for a seeded user — the row
 * Better Auth's email/password sign-in reads. Seeding only `User.passwordHash`
 * (the legacy column Better Auth never reads) leaves the user unable to sign
 * in. Idempotent: the Account id is derived from the user id, matching the
 * BA2 migration's `cred_<userId>` backfill convention.
 */
async function ensureCredentialAccount(userId: string, passwordHash: string): Promise<void> {
  await prisma.account.upsert({
    where: { id: `cred_${userId}` },
    update: { password: passwordHash },
    create: {
      id: `cred_${userId}`,
      userId,
      accountId: userId,
      providerId: 'credential',
      password: passwordHash,
    },
  });
}

// ── Seed ──────────────────────────────────────────────────────────────────────

/**
 * Prod-safe additive permission sync. Grants any permissions MISSING from the
 * existing Super Admin + Admin roles without recreating roles/users or removing
 * any grant. Required because the role upserts below use `update: {}`, so a role
 * created before a permission module was added (e.g. NE9 `campaigns`) never
 * receives the new grants on re-seed. Idempotent via @@unique([roleId,
 * permission]) + skipDuplicates.
 */
async function syncRolePermissions(client: PrismaClient): Promise<void> {
  const targets: Array<{ name: string; permissions: string[] }> = [
    { name: 'Super Admin', permissions: ALL_PERMISSIONS },
    { name: 'Admin', permissions: ADMIN_PERMISSIONS },
  ];
  for (const t of targets) {
    const role = await client.role.findUnique({ where: { name: t.name } });
    if (!role) {
      console.log(`  perm-sync: role "${t.name}" absent — skipped`);
      continue;
    }
    const result = await client.rolePermission.createMany({
      data: t.permissions.map((permission) => ({ roleId: role.id, permission })),
      skipDuplicates: true,
    });
    console.log(`  perm-sync: ${t.name} +${result.count} new permission(s)`);
  }
}

/**
 * Make the guest-checkout switch a real row rather than an implied constant.
 *
 * `CheckoutService.getSettings()` falls back to `guestCheckoutEnabled: true`
 * when the setting has never been written, and nothing wrote it. So the first
 * deploy carrying guest checkout would have turned it ON with no operator
 * action, while the admin screen showed a value that existed only as a default
 * in code. Whether on is the right default is the operator's call; it should
 * not be one nobody made.
 *
 * CREATE-ONLY on purpose. An upsert that also updated would reset an operator
 * who had deliberately switched guest checkout off, on every single deploy.
 */
async function seedGuestCheckoutFlag(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.storeSetting.findUnique({
    where: { group_key: { group: 'checkout', key: 'guestCheckoutEnabled' } },
    select: { value: true },
  });
  if (existing) {
    console.log(`  Checkout: guestCheckoutEnabled already set to ${String(existing.value)}`);
    return;
  }
  await prisma.storeSetting.create({
    data: { group: 'checkout', key: 'guestCheckoutEnabled', value: true },
  });
  console.log('  Checkout: guestCheckoutEnabled seeded to true (first run only)');
}

/** One line for the seed log: what the tax seed plants for this config. */
function describeTax(config: StoreRuntimeConfig): string {
  if (!hasDomesticTaxZone(config)) {
    return 'zero-rated catch-all only (no country or VAT rate configured)';
  }
  const percent = (config.money.vatRate * 100).toFixed(2).replace(/\.?0+$/, '');
  return `${config.identity.address.country} domestic zone at ${percent}% VAT + zero-rated catch-all (default)`;
}

async function main() {
  console.log('Start seeding ...');

  // ── Runtime store config (DR-31, plan E1.4) ────────────────────────────────
  // Every country, currency and rate below reads from this one object: the
  // active scenario fixture when STORE_CONFIG_FIXTURE names one, otherwise the
  // config the database already holds (a store configured through the stepper
  // or the admin), otherwise the neutral config a fresh engine runs on. A
  // deploy seed must never run a configured store against the neutral config:
  // that would retire its zones and rates (security review C1).
  const activeFixtureId = process.env[STORE_CONFIG_FIXTURE_ENV];
  // Checked here, before any branch: the SEED_SCOPE deploy branch below also
  // reads the fixture, for shipping and tax, and returns before the fixture
  // seeder at the end runs its own check.
  if (activeFixtureId) assertFixtureAllowed(activeFixtureId);
  // The install stepper's config (plan E4.4): written into the settings rows
  // BEFORE anything else reads the config, because the notification templates
  // are seeded with the locale set the database holds at seed time.
  const fileConfig = storeConfigFromEnv();
  if (fileConfig && activeFixtureId) {
    throw new Error(
      `${STORE_CONFIG_FILE_ENV} and ${STORE_CONFIG_FIXTURE_ENV} are both set; a store is configured from one source`,
    );
  }
  if (fileConfig) {
    const written = await seedStoreConfig(prisma, fileConfig);
    console.log(
      `  StoreConfig: ${process.env[STORE_CONFIG_FILE_ENV]} wrote ${written} settings rows`,
    );
  }
  const logoUrl = process.env['STORE_LOGO_URL'];
  if (logoUrl) {
    const wrote = await seedLogoUrl(prisma, logoUrl);
    console.log(`  Logo: ${wrote ? 'written' : 'kept the existing value'}`);
  }
  const storedConfig = storeConfigFromSettingRows(
    await prisma.storeSetting.findMany({ select: { group: true, key: true, value: true } }),
  );
  const storeConfig: StoreRuntimeConfig = activeFixtureId
    ? runtimeConfigOfFixture(activeStoreConfigFixture())
    : storedConfig;
  const configSource = activeFixtureId
    ? `fixture ${activeFixtureId}`
    : fileConfig
      ? `file ${process.env[STORE_CONFIG_FILE_ENV]}`
      : isConfiguredStore(storedConfig)
        ? 'database rows'
        : 'neutral (empty database)';
  console.log(
    `  Store config: ${configSource}, ` +
      `currency ${storeConfig.money.currencyCode}, country ${storeConfig.identity.address.country || 'none'}`,
  );
  // The sample customers live in the store's own country when it has one.
  const sampleCountry = storeConfig.identity.address.country || 'US';
  // The free-shipping threshold, as the demo promotion and orders advertise it.
  const freeShippingThreshold = formatMoney(300, storeConfig.money);

  // ── Prod-safe targeted seed ────────────────────────────────────────────────
  // SEED_SCOPE=notifications-rbac runs ONLY the additive role-permission sync +
  // the notification template upserts. No demo catalogue, no users, no e2e
  // catalogue. Wired into CI migrate-db so every prod deploy keeps the
  // operator-facing notification + RBAC data in lockstep with the code: `db
  // push` creates the empty tables, this fills the rows the admin UI + RBAC
  // guard need. Both halves are idempotent and never overwrite an operator edit.
  if (process.env.SEED_SCOPE === 'notifications-rbac') {
    await syncRolePermissions(prisma);
    await reconcileRolePermissions(prisma);
    await purgeRetiredSettingGroups(prisma);
    await seedNotificationTemplates(prisma, storeConfig.localization.supportedLocales);
    console.log('  NotificationTemplates: 36 flow codes upserted');
    // Shipping from the runtime config: the domestic zone over areaServed and
    // its default FLAT_RATE method, at the starter rate the CLI stepper
    // replaces. Idempotent, additive, and it retires the zones earlier
    // client-shaped seeds planted if a shared database still carries them.
    const shipping = await seedShipping(prisma, storeConfig, { flatRate: seedFlatRate() });
    console.log(
      shipping
        ? `  Shipping: ${shipping.methodId} @ ${formatMoney(shipping.price, storeConfig.money)} (default)`
        : '  Shipping: no country configured, no zone seeded',
    );

    // Tax was once seeded by NO branch, so production shipped untaxed: this is
    // the only seed path CI runs, and it planted shipping without a zone. With
    // a standard rate live that is the difference between an invoice that
    // reconciles and one that does not.
    await seedTax(prisma, storeConfig);
    console.log(`  Tax: ${describeTax(storeConfig)}`);

    // Guest checkout: write the flag once so its value lives in the database
    // instead of in a code default nobody chose. Never overwrites an operator
    // who has already set it.
    await seedGuestCheckoutFlag(prisma);

    // Cash on delivery: the API refuses an order when the enabled set is empty
    // (finding D2), so the store's first tender has to exist as a row.
    // Create-only, so an operator who disables it is not overridden on the
    // next deploy.
    const payment = await seedPaymentMethods(prisma);
    console.log(
      `  Payment methods: ${payment.code} ${payment.created ? 'created' : 'already present'}`,
    );

    // After the writes, never before: a flush that ran first would simply
    // repopulate from the rows this branch is about to replace. The tax-zone
    // cache in particular is invalidated only by the admin endpoints, so a
    // zone written directly by a seed is invisible for its full hour without
    // this.
    await flushMoneyCache();

    console.log('\nProd-safe seed (notifications + RBAC + shipping + tax) finished.');
    return;
  }

  // ── Dev reseed tripwire ───────────────────────────────────────────────────
  // Everything below this line is the DESTRUCTIVE demo seed. Its cleanup block
  // hard-deletes every order outside order-1..4, every review outside
  // review-1..3, every non-seeded user together with their addresses,
  // notifications and wishlist items, and every gift card but the seeded one.
  // On the dev database that means one bare `prisma db seed` destroys the QA
  // repro artifacts several remediation plans still need.
  //
  // Placed AFTER the SEED_SCOPE early return on purpose: CI runs the prod seed
  // with SEED_SCOPE=notifications-rbac and must never meet this guard. The three
  // test harnesses all target merchants_engine_test and never meet it either.
  //
  // Fail-closed, and it names its own override. Plan K decision K-D6, made
  // an allow-list at E4: the test database is the only one this branch runs
  // on without being told to. The dev database, a production database (the
  // install stepper creates `merchants_engine`) and a name nobody expected
  // all need SEED_DEV_OK=1, because the previous shape refused one name and
  // let every other through, which is the deny-list class E4 retired.
  const seedDatabaseName = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
    } catch {
      return '';
    }
  })();
  if (!DEMO_SEED_DATABASES.includes(seedDatabaseName) && process.env.SEED_DEV_OK !== '1') {
    // Never print DATABASE_URL itself: it carries the password (§3.7).
    console.error(
      `\nRefusing to seed "${seedDatabaseName || '(no database name)'}". This seed is destructive:\n` +
        '  - hard-deletes every order outside order-1..4 and their items\n' +
        '  - hard-deletes every review outside review-1..3\n' +
        '  - hard-deletes every non-seeded user with their addresses, notifications and wishlist rows\n' +
        '  - hard-deletes every gift card except the seeded one\n' +
        "On a store with orders that is the store's history; on dev it is the QA repro artifacts.\n" +
        `Only ${DEMO_SEED_DATABASES.join(', ')} run it unasked. If you really mean it, re-run with SEED_DEV_OK=1.`,
    );
    process.exitCode = 1;
    return;
  }

  // ── Roles ────────────────────────────────────────────────────────────────

  const superAdminRole = await prisma.role.upsert({
    where: { name: 'Super Admin' },
    update: {},
    create: {
      name: 'Super Admin',
      description: 'Full system access — all permissions',
      permissions: { create: ALL_PERMISSIONS.map((p) => ({ permission: p })) },
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'Admin' },
    update: {},
    create: {
      name: 'Admin',
      description: 'Broad admin access — all except admin_users:manage',
      permissions: { create: ADMIN_PERMISSIONS.map((p) => ({ permission: p })) },
    },
  });

  const managerRole = await prisma.role.upsert({
    where: { name: 'Manager' },
    update: {},
    create: {
      name: 'Manager',
      description: 'Manages products, inventory, orders, and promotions',
      permissions: { create: MANAGER_PERMISSIONS.map((p) => ({ permission: p })) },
    },
  });

  const supportRole = await prisma.role.upsert({
    where: { name: 'Support' },
    update: {},
    create: {
      name: 'Support',
      description: 'Customer support — read-only on most, write on orders/returns/customers',
      permissions: { create: SUPPORT_PERMISSIONS.map((p) => ({ permission: p })) },
    },
  });

  console.log('  Roles: Super Admin, Admin, Manager, Support');

  // The role upserts above use `update: {}`, so an existing dev database keeps
  // whatever grants it already had, including the legacy hyphenated + invented
  // keys. Sync forward, then reconcile, exactly as the prod branch does.
  await syncRolePermissions(prisma);
  await reconcileRolePermissions(prisma);
  await purgeRetiredSettingGroups(prisma);

  // ── Users ────────────────────────────────────────────────────────────────

  const adminHash = await bcrypt.hash('Admin123!', 12);
  const customerHash = await bcrypt.hash('password123', 12);

  // Legacy admin users (Admin123!)
  const superAdminUser = await prisma.user.upsert({
    where: { email: 'superadmin@merchants.test' },
    update: {},
    create: {
      email: 'superadmin@merchants.test',
      passwordHash: adminHash,
      name: 'Super Admin',
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      roleId: superAdminRole.id,
      emailVerified: true,
    },
  });

  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@merchants.test' },
    update: {},
    create: {
      email: 'manager@merchants.test',
      passwordHash: adminHash,
      name: 'Manager User',
      firstName: 'Manager',
      lastName: 'User',
      role: 'MANAGER',
      roleId: managerRole.id,
      emailVerified: true,
    },
  });

  const supportUser = await prisma.user.upsert({
    where: { email: 'support@merchants.test' },
    update: {},
    create: {
      email: 'support@merchants.test',
      passwordHash: adminHash,
      name: 'Support Agent',
      firstName: 'Support',
      lastName: 'Agent',
      role: 'SUPPORT',
      roleId: supportRole.id,
      emailVerified: true,
    },
  });

  // Primary test users (password123)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@merchants.test' },
    update: { role: 'SUPER_ADMIN', roleId: superAdminRole.id },
    create: {
      email: 'admin@merchants.test',
      passwordHash: customerHash,
      name: 'Badii Admin',
      firstName: 'Badii',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      roleId: superAdminRole.id,
      emailVerified: true,
    },
  });

  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@merchants.test' },
    update: {},
    create: {
      email: 'staff@merchants.test',
      passwordHash: customerHash,
      name: 'Staff Member',
      firstName: 'Staff',
      lastName: 'Member',
      role: 'ADMIN',
      roleId: adminRole.id,
      emailVerified: true,
    },
  });

  const customer1 = await prisma.user.upsert({
    where: { email: 'customer1@test.com' },
    update: {},
    create: {
      email: 'customer1@test.com',
      passwordHash: customerHash,
      name: 'Sam Customer',
      firstName: 'Sam',
      lastName: 'Customer',
      role: 'CUSTOMER',
      emailVerified: true,
    },
  });

  const customer2 = await prisma.user.upsert({
    where: { email: 'customer2@test.com' },
    update: {},
    create: {
      email: 'customer2@test.com',
      passwordHash: customerHash,
      name: 'Sara Hassan',
      firstName: 'Sara',
      lastName: 'Hassan',
      role: 'CUSTOMER',
      emailVerified: true,
    },
  });

  // Better Auth credential accounts — every seeded user needs one to sign in
  // (email/password auth reads Account.password, not User.passwordHash).
  await Promise.all([
    ensureCredentialAccount(superAdminUser.id, adminHash),
    ensureCredentialAccount(managerUser.id, adminHash),
    ensureCredentialAccount(supportUser.id, adminHash),
    ensureCredentialAccount(adminUser.id, customerHash),
    ensureCredentialAccount(staffUser.id, customerHash),
    ensureCredentialAccount(customer1.id, customerHash),
    ensureCredentialAccount(customer2.id, customerHash),
  ]);

  console.log('  Users: admin, staff, customer1, customer2 + legacy admin users');

  // ── Addresses ────────────────────────────────────────────────────────────

  const existingAddr1 = await prisma.address.findFirst({ where: { userId: customer1.id } });
  if (!existingAddr1) {
    await prisma.address.create({
      data: {
        userId: customer1.id,
        label: 'Home',
        fullName: 'Sam Customer',
        phone: '+10000000001',
        addressLine1: 'Villa 12, Street 40',
        addressLine2: 'Sample District',
        city: 'Sample City',
        country: sampleCountry,
        postalCode: '10000',
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
  }

  const existingAddr2 = await prisma.address.findFirst({ where: { userId: customer2.id } });
  if (!existingAddr2) {
    await prisma.address.create({
      data: {
        userId: customer2.id,
        label: 'Apartment',
        fullName: 'Sara Hassan',
        phone: '+10000000002',
        addressLine1: 'Apt 8B, Tower 3',
        addressLine2: 'Marina District',
        city: 'Sample Harbour',
        country: sampleCountry,
        postalCode: '10001',
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
  }

  console.log('  Addresses: customer1 (Sample City), customer2 (Sample Harbour)');

  // ── Tax Zones & Classes ───────────────────────────────────────────────────

  // Shared with the prod-safe branch above, so both paths seed identical tax
  // data. See prisma/seeds/store-config/tax.ts for why every upsert carries a
  // real `update` payload rather than the `update: {}` this block used to have.
  await seedGuestCheckoutFlag(prisma);
  await seedPaymentMethods(prisma);
  const { standardClassId: standardTaxClassId } = await seedTax(prisma, storeConfig);

  console.log(`  Tax Zones: ${describeTax(storeConfig)}`);

  // ── Product Types ─────────────────────────────────────────────────────────

  const ptClothing = await prisma.productType.upsert({
    where: { code: 'clothing' },
    update: {},
    create: {
      id: 'pt-clothing',
      name: { default: 'Clothing', en: 'Clothing', fr: 'Vêtements' },
      code: 'clothing',
      taxClassId: standardTaxClassId,
    },
  });

  const ptElectronics = await prisma.productType.upsert({
    where: { code: 'electronics' },
    update: {},
    create: {
      id: 'pt-electronics',
      name: { default: 'Electronics', en: 'Electronics', fr: 'Électronique' },
      code: 'electronics',
      taxClassId: standardTaxClassId,
    },
  });

  const ptGeneral = await prisma.productType.upsert({
    where: { code: 'general' },
    update: {},
    create: {
      id: 'pt-general',
      name: { default: 'General', en: 'General', fr: 'Général' },
      code: 'general',
      taxClassId: standardTaxClassId,
    },
  });

  console.log('  Product Types: Clothing, Electronics, General');

  // ── Attributes ────────────────────────────────────────────────────────────

  // Clothing: Color + Size
  const attrClothingColor = await prisma.attribute.upsert({
    where: { productTypeId_code: { productTypeId: ptClothing.id, code: 'color' } },
    update: {},
    create: {
      id: 'attr-clothing-color',
      productTypeId: ptClothing.id,
      name: { default: 'Color', en: 'Color', fr: 'Couleur' },
      code: 'color',
      sortOrder: 0,
    },
  });

  const attrClothingSize = await prisma.attribute.upsert({
    where: { productTypeId_code: { productTypeId: ptClothing.id, code: 'size' } },
    update: {},
    create: {
      id: 'attr-clothing-size',
      productTypeId: ptClothing.id,
      name: { default: 'Size', en: 'Size', fr: 'Taille' },
      code: 'size',
      sortOrder: 1,
    },
  });

  // Electronics: Storage + Color
  const attrElecStorage = await prisma.attribute.upsert({
    where: { productTypeId_code: { productTypeId: ptElectronics.id, code: 'storage' } },
    update: {},
    create: {
      id: 'attr-elec-storage',
      productTypeId: ptElectronics.id,
      name: { default: 'Storage', en: 'Storage', fr: 'Stockage' },
      code: 'storage',
      sortOrder: 0,
    },
  });

  const attrElecColor = await prisma.attribute.upsert({
    where: { productTypeId_code: { productTypeId: ptElectronics.id, code: 'color' } },
    update: {},
    create: {
      id: 'attr-elec-color',
      productTypeId: ptElectronics.id,
      name: { default: 'Color', en: 'Color', fr: 'Couleur' },
      code: 'color',
      sortOrder: 1,
    },
  });

  console.log('  Attributes: Color, Size (Clothing); Storage, Color (Electronics)');

  // ── Attribute Values ──────────────────────────────────────────────────────

  // Clothing colors
  const avBlack = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrClothingColor.id, code: 'black' } },
    update: {},
    create: {
      id: 'av-c-black',
      attributeId: attrClothingColor.id,
      value: { default: 'Black', en: 'Black', fr: 'Noir' },
      code: 'black',
      sortOrder: 0,
    },
  });
  const avWhite = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrClothingColor.id, code: 'white' } },
    update: {},
    create: {
      id: 'av-c-white',
      attributeId: attrClothingColor.id,
      value: { default: 'White', en: 'White', fr: 'Blanc' },
      code: 'white',
      sortOrder: 1,
    },
  });
  const avRed = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrClothingColor.id, code: 'red' } },
    update: {},
    create: {
      id: 'av-c-red',
      attributeId: attrClothingColor.id,
      value: { default: 'Red', en: 'Red', fr: 'Rouge' },
      code: 'red',
      sortOrder: 2,
    },
  });
  const avBlue = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrClothingColor.id, code: 'blue' } },
    update: {},
    create: {
      id: 'av-c-blue',
      attributeId: attrClothingColor.id,
      value: { default: 'Blue', en: 'Blue', fr: 'Bleu' },
      code: 'blue',
      sortOrder: 3,
    },
  });

  // Clothing sizes
  const avS = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrClothingSize.id, code: 's' } },
    update: {},
    create: {
      id: 'av-s-s',
      attributeId: attrClothingSize.id,
      value: { default: 'S', en: 'S', fr: 'Petit' },
      code: 's',
      sortOrder: 0,
    },
  });
  const avM = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrClothingSize.id, code: 'm' } },
    update: {},
    create: {
      id: 'av-s-m',
      attributeId: attrClothingSize.id,
      value: { default: 'M', en: 'M', fr: 'Moyen' },
      code: 'm',
      sortOrder: 1,
    },
  });
  const avL = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrClothingSize.id, code: 'l' } },
    update: {},
    create: {
      id: 'av-s-l',
      attributeId: attrClothingSize.id,
      value: { default: 'L', en: 'L', fr: 'Grand' },
      code: 'l',
      sortOrder: 2,
    },
  });
  const avXL = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrClothingSize.id, code: 'xl' } },
    update: {},
    create: {
      id: 'av-s-xl',
      attributeId: attrClothingSize.id,
      value: { default: 'XL', en: 'XL', fr: 'Très grand' },
      code: 'xl',
      sortOrder: 3,
    },
  });

  // Electronics storage
  await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrElecStorage.id, code: '64gb' } },
    update: {},
    create: {
      id: 'av-st-64',
      attributeId: attrElecStorage.id,
      value: { default: '64GB', en: '64GB', fr: '64 Go' },
      code: '64gb',
      sortOrder: 0,
    },
  });
  const av128 = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrElecStorage.id, code: '128gb' } },
    update: {},
    create: {
      id: 'av-st-128',
      attributeId: attrElecStorage.id,
      value: { default: '128GB', en: '128GB', fr: '128 Go' },
      code: '128gb',
      sortOrder: 1,
    },
  });
  const av256 = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrElecStorage.id, code: '256gb' } },
    update: {},
    create: {
      id: 'av-st-256',
      attributeId: attrElecStorage.id,
      value: { default: '256GB', en: '256GB', fr: '256 Go' },
      code: '256gb',
      sortOrder: 2,
    },
  });

  // Electronics colors
  const avEBlack = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrElecColor.id, code: 'black' } },
    update: {},
    create: {
      id: 'av-ec-black',
      attributeId: attrElecColor.id,
      value: { default: 'Black', en: 'Black', fr: 'Noir' },
      code: 'black',
      sortOrder: 0,
    },
  });
  const avEWhite = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrElecColor.id, code: 'white' } },
    update: {},
    create: {
      id: 'av-ec-white',
      attributeId: attrElecColor.id,
      value: { default: 'White', en: 'White', fr: 'Blanc' },
      code: 'white',
      sortOrder: 1,
    },
  });
  const avETitanium = await prisma.attributeValue.upsert({
    where: { attributeId_code: { attributeId: attrElecColor.id, code: 'titanium' } },
    update: {},
    create: {
      id: 'av-ec-titanium',
      attributeId: attrElecColor.id,
      value: { default: 'Titanium', en: 'Titanium', fr: 'Titane' },
      code: 'titanium',
      sortOrder: 2,
    },
  });

  console.log('  Attribute Values: Color (4), Size (4), Storage (3), Elec Color (3)');

  // ── Categories ────────────────────────────────────────────────────────────

  const catElectronics = await prisma.category.upsert({
    where: { slug: 'electronics' },
    update: {},
    create: {
      id: 'cat-electronics',
      name: { default: 'Electronics', en: 'Electronics', fr: 'Électronique' },
      slug: 'electronics',
      depth: 0,
      path: '/cat-electronics',
      sortOrder: 0,
      isVisible: true,
    },
  });

  const catPhones = await prisma.category.upsert({
    where: { slug: 'phones' },
    update: {},
    create: {
      id: 'cat-phones',
      name: { default: 'Phones', en: 'Phones', fr: 'Téléphones' },
      slug: 'phones',
      parentId: catElectronics.id,
      depth: 1,
      path: '/cat-electronics/cat-phones',
      sortOrder: 0,
      isVisible: true,
    },
  });

  const catFashion = await prisma.category.upsert({
    where: { slug: 'fashion' },
    update: {},
    create: {
      id: 'cat-fashion',
      name: { default: 'Fashion', en: 'Fashion', fr: 'Mode' },
      slug: 'fashion',
      depth: 0,
      path: '/cat-fashion',
      sortOrder: 1,
      isVisible: true,
    },
  });

  const catMen = await prisma.category.upsert({
    where: { slug: 'men' },
    update: {},
    create: {
      id: 'cat-men',
      name: { default: "Men's", en: "Men's", fr: 'Homme' },
      slug: 'men',
      parentId: catFashion.id,
      depth: 1,
      path: '/cat-fashion/cat-men',
      sortOrder: 0,
      isVisible: true,
    },
  });

  const catShoes = await prisma.category.upsert({
    where: { slug: 'shoes' },
    update: {},
    create: {
      id: 'cat-shoes',
      name: { default: 'Shoes', en: 'Shoes', fr: 'Chaussures' },
      slug: 'shoes',
      parentId: catMen.id,
      depth: 2,
      path: '/cat-fashion/cat-men/cat-shoes',
      sortOrder: 0,
      isVisible: true,
    },
  });

  console.log('  Categories: Electronics > Phones, Fashion > Men > Shoes');

  // ── Assets (placeholder images) ───────────────────────────────────────────

  const assetData = [
    { id: 'asset-iphone', name: 'iPhone 15 Pro', slug: 'iphone-15-pro' },
    { id: 'asset-samsung', name: 'Samsung Galaxy S24', slug: 'samsung-galaxy-s24' },
    { id: 'asset-headphones', name: 'Sony Headphones', slug: 'sony-headphones' },
    { id: 'asset-tshirt', name: 'Basic T-Shirt', slug: 'basic-t-shirt' },
    { id: 'asset-polo', name: 'Classic Polo', slug: 'classic-polo' },
    { id: 'asset-jeans', name: 'Slim Fit Jeans', slug: 'slim-fit-jeans' },
    { id: 'asset-shoes', name: 'Running Shoes', slug: 'running-shoes' },
    { id: 'asset-wallet', name: 'Leather Wallet', slug: 'leather-wallet' },
    { id: 'asset-bottle', name: 'Water Bottle', slug: 'water-bottle' },
    { id: 'asset-backpack', name: 'Canvas Backpack', slug: 'canvas-backpack' },
  ];

  // The four canonical widths the asset pipeline renders. A seeded asset carries
  // the same variant set a processed upload does, so the storefront picks a
  // variant URL for every seeded product and the wishlist suite, which needs a
  // READY primary asset with variants, runs on this seed alone. The artefact
  // URLs are one-pixel data URIs rather than a made-up CDN host: a browser
  // renders them without a network fetch, so no page that lists a seeded
  // product logs a failed resource load.
  const SEED_VARIANT_WIDTHS = { thumbnail: 160, small: 400, medium: 800, large: 1600 } as const;
  const ONE_PIXEL_WEBP =
    'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  const seedImageVariants = (slug: string): Prisma.InputJsonValue => {
    const artefact = (name: string, format: 'webp' | 'avif', width: number) => ({
      url: ONE_PIXEL_WEBP,
      storagePath: `products/${slug}/${name}.${format}`,
      width,
      height: width,
      size: 44,
    });
    return Object.fromEntries(
      Object.entries(SEED_VARIANT_WIDTHS).map(([name, width]) => [
        name,
        { webp: artefact(name, 'webp', width), avif: artefact(name, 'avif', width) },
      ]),
    );
  };

  const assets: Record<string, { id: string }> = {};
  for (const a of assetData) {
    const asset = await prisma.asset.upsert({
      where: { id: a.id },
      update: { variants: seedImageVariants(a.slug) },
      create: {
        variants: seedImageVariants(a.slug),
        id: a.id,
        alt: { default: a.name, en: a.name, fr: a.name },
        type: 'IMAGE',
        mimeType: 'image/jpeg',
        fileSize: 102400,
        width: 800,
        height: 800,
        status: 'READY',
        storagePath: `products/${a.slug}/main.jpg`,
        url: `https://cdn.merchants.test/products/${a.slug}/main.jpg`,
        originalStoragePath: `products/${a.slug}/main.jpg`,
      },
    });
    assets[a.id] = asset;
  }

  console.log('  Assets: 10 placeholder product images');

  // ── Products ──────────────────────────────────────────────────────────────

  type ProductSeed = {
    id: string;
    name: object;
    slug: string;
    description: object;
    shortDescription: object;
    productTypeId: string;
    isFeatured: boolean;
    tags: string[];
    assetId: string;
    categories: string[];
  };

  const productSeeds: ProductSeed[] = [
    {
      id: 'prod-iphone',
      name: { default: 'iPhone 15 Pro', en: 'iPhone 15 Pro', fr: 'iPhone 15 Pro' },
      slug: 'iphone-15-pro',
      description: {
        default: 'The latest iPhone with A17 Pro chip and titanium design.',
        en: 'The latest iPhone with A17 Pro chip and titanium design.',
        fr: 'Le dernier iPhone, avec la puce A17 Pro et un châssis en titane.',
      },
      shortDescription: {
        default: 'A17 Pro chip, titanium design, 48MP camera.',
        en: 'A17 Pro chip, titanium design, 48MP camera.',
        fr: 'Puce A17 Pro, châssis en titane, capteur 48 Mpx.',
      },
      productTypeId: ptElectronics.id,
      isFeatured: true,
      tags: ['smartphone', 'apple', 'ios'],
      assetId: 'asset-iphone',
      categories: [catPhones.id, catElectronics.id],
    },
    {
      id: 'prod-samsung',
      name: { default: 'Samsung Galaxy S24', en: 'Samsung Galaxy S24', fr: 'Samsung Galaxy S24' },
      slug: 'samsung-galaxy-s24',
      description: {
        default: 'Samsung flagship with Galaxy AI and Snapdragon 8 Gen 3.',
        en: 'Samsung flagship with Galaxy AI and Snapdragon 8 Gen 3.',
        fr: 'Le haut de gamme Samsung, avec Galaxy AI et Snapdragon 8 Gen 3.',
      },
      shortDescription: {
        default: 'Galaxy AI, 50MP camera, 4000mAh battery.',
        en: 'Galaxy AI, 50MP camera, 4000mAh battery.',
        fr: 'Galaxy AI, capteur 50 Mpx, batterie 4000 mAh.',
      },
      productTypeId: ptElectronics.id,
      isFeatured: true,
      tags: ['smartphone', 'samsung', 'android'],
      assetId: 'asset-samsung',
      categories: [catPhones.id, catElectronics.id],
    },
    {
      id: 'prod-headphones',
      name: {
        default: 'Sony WH-1000XM5 Headphones',
        en: 'Sony WH-1000XM5 Headphones',
        fr: 'Casque Sony WH-1000XM5',
      },
      slug: 'sony-wh-1000xm5',
      description: {
        default: 'Industry-leading noise cancellation with 30hr battery life.',
        en: 'Industry-leading noise cancellation with 30hr battery life.',
        fr: 'Réduction de bruit de référence, autonomie de 30 heures.',
      },
      shortDescription: {
        default: 'ANC, 30hr battery, multipoint connection.',
        en: 'ANC, 30hr battery, multipoint connection.',
        fr: 'Réduction de bruit, 30 heures de batterie, connexion multipoint.',
      },
      productTypeId: ptElectronics.id,
      isFeatured: false,
      tags: ['headphones', 'sony', 'wireless', 'anc'],
      assetId: 'asset-headphones',
      categories: [catElectronics.id],
    },
    {
      id: 'prod-tshirt',
      name: {
        default: 'Premium Cotton T-Shirt',
        en: 'Premium Cotton T-Shirt',
        fr: 'T-shirt en coton premium',
      },
      slug: 'premium-cotton-t-shirt',
      description: {
        default: '100% organic cotton, pre-shrunk, ultra-soft jersey knit.',
        en: '100% organic cotton, pre-shrunk, ultra-soft jersey knit.',
        fr: '100% coton biologique, prérétréci, maille jersey très douce.',
      },
      shortDescription: {
        default: '100% organic cotton, available in 4 colors.',
        en: '100% organic cotton, available in 4 colors.',
        fr: '100% coton biologique, disponible en 4 couleurs.',
      },
      productTypeId: ptClothing.id,
      isFeatured: false,
      tags: ['t-shirt', 'cotton', 'casual'],
      assetId: 'asset-tshirt',
      categories: [catMen.id, catFashion.id],
    },
    {
      id: 'prod-polo',
      name: {
        default: 'Classic Piqué Polo Shirt',
        en: 'Classic Piqué Polo Shirt',
        fr: 'Polo classique en piqué',
      },
      slug: 'classic-pique-polo',
      description: {
        default: 'Timeless polo shirt in premium piqué fabric with ribbed collar.',
        en: 'Timeless polo shirt in premium piqué fabric with ribbed collar.',
        fr: 'Polo intemporel en piqué premium, col côtelé.',
      },
      shortDescription: {
        default: 'Premium piqué, ribbed collar, 3-button placket.',
        en: 'Premium piqué, ribbed collar, 3-button placket.',
        fr: 'Piqué premium, col côtelé, patte 3 boutons.',
      },
      productTypeId: ptClothing.id,
      isFeatured: false,
      tags: ['polo', 'shirt', 'smart-casual'],
      assetId: 'asset-polo',
      categories: [catMen.id, catFashion.id],
    },
    {
      id: 'prod-jeans',
      name: {
        default: 'Slim Fit Stretch Jeans',
        en: 'Slim Fit Stretch Jeans',
        fr: 'Jean slim stretch',
      },
      slug: 'slim-fit-stretch-jeans',
      description: {
        default: 'Modern slim fit jeans with 2% elastane for all-day comfort.',
        en: 'Modern slim fit jeans with 2% elastane for all-day comfort.',
        fr: 'Jean coupe slim avec 2% élasthanne, confort toute la journée.',
      },
      shortDescription: {
        default: '98% cotton, 2% elastane stretch denim.',
        en: '98% cotton, 2% elastane stretch denim.',
        fr: '98% coton, 2% élasthanne.',
      },
      productTypeId: ptClothing.id,
      isFeatured: false,
      tags: ['jeans', 'denim', 'slim'],
      assetId: 'asset-jeans',
      categories: [catMen.id, catFashion.id],
    },
    {
      id: 'prod-shoes',
      name: {
        default: 'Urban Runner Sneakers',
        en: 'Urban Runner Sneakers',
        fr: 'Baskets Urban Runner',
      },
      slug: 'urban-runner-sneakers',
      description: {
        default: 'Lightweight running sneakers with responsive foam midsole.',
        en: 'Lightweight running sneakers with responsive foam midsole.',
        fr: 'Baskets de course légères, semelle intermédiaire en mousse réactive.',
      },
      shortDescription: {
        default: 'Breathable mesh upper, foam midsole.',
        en: 'Breathable mesh upper, foam midsole.',
        fr: 'Tige en mesh respirant, semelle en mousse.',
      },
      productTypeId: ptGeneral.id,
      isFeatured: true,
      tags: ['shoes', 'running', 'sneakers'],
      assetId: 'asset-shoes',
      categories: [catShoes.id, catMen.id],
    },
    {
      id: 'prod-wallet',
      name: {
        default: 'Genuine Leather Bifold Wallet',
        en: 'Genuine Leather Bifold Wallet',
        fr: 'Portefeuille en cuir véritable',
      },
      slug: 'genuine-leather-wallet',
      description: {
        default: 'Hand-stitched bifold wallet in full-grain leather with RFID blocking.',
        en: 'Hand-stitched bifold wallet in full-grain leather with RFID blocking.',
        fr: 'Portefeuille deux volets cousu main en cuir pleine fleur, avec blocage RFID.',
      },
      shortDescription: {
        default: 'Full-grain leather, RFID blocking, 8 card slots.',
        en: 'Full-grain leather, RFID blocking, 8 card slots.',
        fr: 'Cuir pleine fleur, blocage RFID, 8 emplacements cartes.',
      },
      productTypeId: ptGeneral.id,
      isFeatured: false,
      tags: ['wallet', 'leather', 'accessory'],
      assetId: 'asset-wallet',
      categories: [catMen.id],
    },
    {
      id: 'prod-bottle',
      name: {
        default: 'Stainless Steel Water Bottle',
        en: 'Stainless Steel Water Bottle',
        fr: 'Bouteille en acier inoxydable',
      },
      slug: 'stainless-steel-water-bottle',
      description: {
        default: 'Double-wall vacuum insulated bottle keeps drinks cold 24hr or hot 12hr.',
        en: 'Double-wall vacuum insulated bottle keeps drinks cold 24hr or hot 12hr.',
        fr: 'Bouteille isotherme double paroi, 24 heures au froid ou 12 heures au chaud.',
      },
      shortDescription: {
        default: 'Vacuum insulated, 500ml, BPA-free.',
        en: 'Vacuum insulated, 500ml, BPA-free.',
        fr: 'Isolation sous vide, 500 ml, sans BPA.',
      },
      productTypeId: ptGeneral.id,
      isFeatured: false,
      tags: ['bottle', 'hydration', 'steel'],
      assetId: 'asset-bottle',
      categories: [],
    },
    {
      id: 'prod-backpack',
      name: {
        default: 'Canvas City Backpack',
        en: 'Canvas City Backpack',
        fr: 'Sac à dos urbain en toile',
      },
      slug: 'canvas-city-backpack',
      description: {
        default: '20L urban backpack in waxed canvas with laptop sleeve and organiser pockets.',
        en: '20L urban backpack in waxed canvas with laptop sleeve and organiser pockets.',
        fr: 'Sac à dos urbain 20 L en toile cirée, compartiment ordinateur et poches de rangement.',
      },
      shortDescription: {
        default: '20L waxed canvas, 15" laptop sleeve, waterproof.',
        en: '20L waxed canvas, 15" laptop sleeve, waterproof.',
        fr: '20 L de toile cirée, compartiment ordinateur 15 pouces, imperméable.',
      },
      productTypeId: ptGeneral.id,
      isFeatured: false,
      tags: ['backpack', 'bag', 'canvas'],
      assetId: 'asset-backpack',
      categories: [],
    },
  ];

  const products: Record<string, { id: string }> = {};
  for (const p of productSeeds) {
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        shortDescription: p.shortDescription,
        status: 'ACTIVE',
        productTypeId: p.productTypeId,
        isFeatured: p.isFeatured,
        tags: p.tags,
        publishedAt: new Date(),
      },
    });
    products[p.id] = product;

    // Product asset
    await prisma.productAsset.upsert({
      where: { productId_assetId: { productId: product.id, assetId: p.assetId } },
      update: {},
      create: { productId: product.id, assetId: p.assetId, sortOrder: 0, isPrimary: true },
    });

    // Product categories
    for (const catId of p.categories) {
      await prisma.productCategory.upsert({
        where: { productId_categoryId: { productId: product.id, categoryId: catId } },
        update: {},
        create: { productId: product.id, categoryId: catId },
      });
    }
  }

  console.log(`  Products: ${productSeeds.length} products with assets and categories`);

  // ── Product Specifications ────────────────────────────────────────────────
  //
  // The admin label autocomplete searches the labels already in the catalogue,
  // so without seed rows a fresh dev database and every e2e run offer an empty
  // list, and a "pick an existing label" journey cannot be written at all.
  //
  // The set below is shaped for what the tests need to prove, not for realism
  // alone:
  //   - `Materiau` carries an accent on one product and none on another, so a
  //     search typed without the accent must still find it. That is the whole
  //     point of the server-side fold.
  //   - `Materiau` and `Garantie` each sit on several products, so the
  //     most-used-first ordering has something to order.
  //   - `Autonomie` sits on exactly one product, so the boundary between
  //     picking an existing label and creating a new one is visible.
  //   - Coverage stays BELOW `MIN_FACET_COVERAGE` (6 by default) for every
  //     label, so the admin corpus and the storefront facet rail legitimately
  //     disagree. That disagreement is the standing proof that the autocomplete
  //     must not be built on `listSpecFacets`.
  //   - One value is deliberately longer than `MAX_FACET_VALUE_LENGTH` (32), so
  //     the facet length filter has something to exclude.
  //
  // `key` and `valueKey` are derived with the shared fold rather than written
  // as literals, so a change to the fold cannot silently leave the seed behind.
  type SpecText = { default: string; fr: string; en: string };
  type SpecSeed = { productId: string; label: SpecText; value: SpecText };

  const specSeeds: SpecSeed[] = [
    {
      productId: 'prod-iphone',
      label: { default: 'Matériau', fr: 'Matériau', en: 'Material' },
      value: { default: 'Titane', fr: 'Titane', en: 'Titanium' },
    },
    {
      productId: 'prod-iphone',
      label: { default: 'Garantie', fr: 'Garantie', en: 'Warranty' },
      value: { default: '24 mois', fr: '24 mois', en: '24 months' },
    },
    {
      productId: 'prod-iphone',
      label: { default: 'Autonomie', fr: 'Autonomie', en: 'Battery life' },
      value: { default: '29 h', fr: '29 h', en: '29 h' },
    },
    {
      // Unaccented spelling of the same label, on purpose: it folds onto the
      // accented one above, so both products answer a search for either.
      productId: 'prod-samsung',
      label: { default: 'Materiau', fr: 'Materiau', en: 'Material' },
      value: { default: 'Aluminium', fr: 'Aluminium', en: 'Aluminium' },
    },
    {
      productId: 'prod-samsung',
      label: { default: 'Garantie', fr: 'Garantie', en: 'Warranty' },
      value: { default: '24 mois', fr: '24 mois', en: '24 months' },
    },
    {
      productId: 'prod-headphones',
      label: { default: 'Garantie', fr: 'Garantie', en: 'Warranty' },
      value: { default: '12 mois', fr: '12 mois', en: '12 months' },
    },
    {
      productId: 'prod-tshirt',
      label: { default: 'Matériau', fr: 'Matériau', en: 'Material' },
      value: { default: 'Coton', fr: 'Coton', en: 'Cotton' },
    },
    {
      productId: 'prod-tshirt',
      label: { default: 'Entretien', fr: 'Entretien', en: 'Care' },
      // Over MAX_FACET_VALUE_LENGTH (32) on purpose, so the facet rail has a
      // value it must exclude while the admin autocomplete still lists it.
      value: {
        default: 'Lavage en machine a 30 degres, sechage a plat',
        fr: 'Lavage en machine a 30 degres, sechage a plat',
        en: 'Machine wash at 30 degrees, dry flat',
      },
    },
  ];

  for (const s of specSeeds) {
    const key = specKey(s.label.default);
    await prisma.productSpec.upsert({
      where: { productId_key: { productId: s.productId, key } },
      update: {},
      create: {
        productId: s.productId,
        label: s.label,
        value: s.value,
        key,
        valueKey: specKey(s.value.default),
        sortOrder: 0,
      },
    });
  }

  console.log(`  Product specs: ${specSeeds.length} specification rows`);

  // ── Product Variants ──────────────────────────────────────────────────────

  type VariantSeed = {
    id: string;
    productId: string;
    sku: string;
    price: number;
    compareAtPrice?: number;
    isDefault: boolean;
    weight?: number;
    avIds: string[];
  };

  const variantSeeds: VariantSeed[] = [
    // iPhone 15 Pro: 128GB/Black, 256GB/Black, 128GB/Titanium
    {
      id: 'var-iphone-128-blk',
      productId: 'prod-iphone',
      sku: 'IPH15PRO-128-BLK',
      price: 4299,
      compareAtPrice: 4599,
      isDefault: true,
      weight: 0.187,
      avIds: [av128.id, avEBlack.id],
    },
    {
      id: 'var-iphone-256-blk',
      productId: 'prod-iphone',
      sku: 'IPH15PRO-256-BLK',
      price: 4799,
      isDefault: false,
      weight: 0.187,
      avIds: [av256.id, avEBlack.id],
    },
    {
      id: 'var-iphone-128-tit',
      productId: 'prod-iphone',
      sku: 'IPH15PRO-128-TIT',
      price: 4299,
      isDefault: false,
      weight: 0.187,
      avIds: [av128.id, avETitanium.id],
    },
    // Samsung Galaxy S24: 128GB/Black, 256GB/White
    {
      id: 'var-samsung-128-blk',
      productId: 'prod-samsung',
      sku: 'SAMS24-128-BLK',
      price: 3499,
      compareAtPrice: 3799,
      isDefault: true,
      weight: 0.167,
      avIds: [av128.id, avEBlack.id],
    },
    {
      id: 'var-samsung-256-wht',
      productId: 'prod-samsung',
      sku: 'SAMS24-256-WHT',
      price: 3899,
      isDefault: false,
      weight: 0.167,
      avIds: [av256.id, avEWhite.id],
    },
    // Sony Headphones: Black, White
    {
      id: 'var-hp-blk',
      productId: 'prod-headphones',
      sku: 'SONY-XM5-BLK',
      price: 1499,
      compareAtPrice: 1699,
      isDefault: true,
      weight: 0.25,
      avIds: [avEBlack.id],
    },
    {
      id: 'var-hp-wht',
      productId: 'prod-headphones',
      sku: 'SONY-XM5-WHT',
      price: 1499,
      isDefault: false,
      weight: 0.25,
      avIds: [avEWhite.id],
    },
    // T-Shirt: S/Black, M/Black, L/White, XL/White
    {
      id: 'var-ts-s-blk',
      productId: 'prod-tshirt',
      sku: 'TS-COT-S-BLK',
      price: 89,
      isDefault: false,
      weight: 0.2,
      avIds: [avS.id, avBlack.id],
    },
    {
      id: 'var-ts-m-blk',
      productId: 'prod-tshirt',
      sku: 'TS-COT-M-BLK',
      price: 89,
      isDefault: true,
      weight: 0.2,
      avIds: [avM.id, avBlack.id],
    },
    {
      id: 'var-ts-l-wht',
      productId: 'prod-tshirt',
      sku: 'TS-COT-L-WHT',
      price: 89,
      isDefault: false,
      weight: 0.2,
      avIds: [avL.id, avWhite.id],
    },
    {
      id: 'var-ts-xl-wht',
      productId: 'prod-tshirt',
      sku: 'TS-COT-XL-WHT',
      price: 89,
      isDefault: false,
      weight: 0.2,
      avIds: [avXL.id, avWhite.id],
    },
    // Polo: S/Red, M/Red, L/Blue
    {
      id: 'var-polo-s-red',
      productId: 'prod-polo',
      sku: 'POLO-S-RED',
      price: 149,
      isDefault: false,
      weight: 0.25,
      avIds: [avS.id, avRed.id],
    },
    {
      id: 'var-polo-m-red',
      productId: 'prod-polo',
      sku: 'POLO-M-RED',
      price: 149,
      isDefault: true,
      weight: 0.25,
      avIds: [avM.id, avRed.id],
    },
    {
      id: 'var-polo-l-blue',
      productId: 'prod-polo',
      sku: 'POLO-L-BLU',
      price: 149,
      isDefault: false,
      weight: 0.25,
      avIds: [avL.id, avBlue.id],
    },
    // Jeans: M/Blue, L/Blue, XL/Black
    {
      id: 'var-jeans-m-blue',
      productId: 'prod-jeans',
      sku: 'JEAN-M-BLU',
      price: 199,
      isDefault: false,
      weight: 0.55,
      avIds: [avM.id, avBlue.id],
    },
    {
      id: 'var-jeans-l-blue',
      productId: 'prod-jeans',
      sku: 'JEAN-L-BLU',
      price: 199,
      isDefault: true,
      weight: 0.55,
      avIds: [avL.id, avBlue.id],
    },
    {
      id: 'var-jeans-xl-blk',
      productId: 'prod-jeans',
      sku: 'JEAN-XL-BLK',
      price: 199,
      isDefault: false,
      weight: 0.55,
      avIds: [avXL.id, avBlack.id],
    },
    // Shoes: one variant (no attributes - General type)
    {
      id: 'var-shoes-42',
      productId: 'prod-shoes',
      sku: 'SHOE-URB-42',
      price: 349,
      compareAtPrice: 399,
      isDefault: true,
      weight: 0.8,
      avIds: [],
    },
    {
      id: 'var-shoes-44',
      productId: 'prod-shoes',
      sku: 'SHOE-URB-44',
      price: 349,
      isDefault: false,
      weight: 0.8,
      avIds: [],
    },
    // Wallet: one variant
    {
      id: 'var-wallet',
      productId: 'prod-wallet',
      sku: 'WALL-LTH-BRN',
      price: 179,
      compareAtPrice: 229,
      isDefault: true,
      weight: 0.08,
      avIds: [],
    },
    // Bottle: Black, Silver
    {
      id: 'var-bottle-blk',
      productId: 'prod-bottle',
      sku: 'BOTL-SS-500-BLK',
      price: 119,
      isDefault: true,
      weight: 0.35,
      avIds: [],
    },
    {
      id: 'var-bottle-sil',
      productId: 'prod-bottle',
      sku: 'BOTL-SS-500-SIL',
      price: 119,
      isDefault: false,
      weight: 0.35,
      avIds: [],
    },
    // Backpack: one variant
    {
      id: 'var-backpack',
      productId: 'prod-backpack',
      sku: 'BKPK-CVS-20L',
      price: 289,
      compareAtPrice: 349,
      isDefault: true,
      weight: 0.65,
      avIds: [],
    },
  ];

  const variants: Record<string, { id: string }> = {};
  for (const v of variantSeeds) {
    const variant = await prisma.productVariant.upsert({
      where: { sku: v.sku },
      update: {},
      create: {
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
        weight: v.weight ?? null,
        isDefault: v.isDefault,
        isActive: true,
      },
    });
    variants[v.id] = variant;

    // Variant attribute values
    for (const avId of v.avIds) {
      await prisma.variantAttributeValue.upsert({
        where: { variantId_attributeValueId: { variantId: variant.id, attributeValueId: avId } },
        update: {},
        create: { variantId: variant.id, attributeValueId: avId },
      });
    }
  }

  console.log(`  Variants: ${variantSeeds.length} variants with attribute values`);

  // ── Inventory ─────────────────────────────────────────────────────────────

  const warehouse = await prisma.inventoryLocation.upsert({
    where: { code: 'MAIN-WH' },
    update: {},
    create: {
      id: 'loc-main-wh',
      name: 'Main Warehouse',
      code: 'MAIN-WH',
      address: { line1: 'Industrial Area, Street 10', city: 'Sample City', country: sampleCountry },
      isActive: true,
    },
  });

  // Stock levels: varied (in-stock, low-stock, out-of-stock)
  const stockData: Record<string, number> = {
    'var-iphone-128-blk': 15,
    'var-iphone-256-blk': 8,
    'var-iphone-128-tit': 0, // out-of-stock
    'var-samsung-128-blk': 20,
    'var-samsung-256-wht': 3, // low-stock
    'var-hp-blk': 25,
    'var-hp-wht': 12,
    'var-ts-s-blk': 50,
    'var-ts-m-blk': 45,
    'var-ts-l-wht': 30,
    'var-ts-xl-wht': 2, // low-stock
    'var-polo-s-red': 20,
    'var-polo-m-red': 18,
    'var-polo-l-blue': 15,
    'var-jeans-m-blue': 12,
    'var-jeans-l-blue': 10,
    'var-jeans-xl-blk': 0, // out-of-stock
    'var-shoes-42': 8,
    'var-shoes-44': 5,
    'var-wallet': 35,
    'var-bottle-blk': 40,
    'var-bottle-sil': 38,
    'var-backpack': 15,
  };

  for (const [varId, onHand] of Object.entries(stockData)) {
    await prisma.stockLevel.upsert({
      where: { variantId_locationId: { variantId: varId, locationId: warehouse.id } },
      update: { onHand, reserved: 0 },
      create: { variantId: varId, locationId: warehouse.id, onHand, reserved: 0 },
    });
  }

  console.log('  Stock: 23 SKUs across main warehouse (mix in-stock / low / OOS)');

  // ── Shipping Zones & Methods ──────────────────────────────────────────────
  // None here. The demo trio this block used to plant (a domestic zone, a
  // regional one and an international one, with flat rates authored in one
  // client's currency) is gone; `seedShipping` reads the runtime config and
  // runs at the end of this function, after every block that could plant a
  // zone of its own, so the config's domestic method holds the store default.

  // ── Carriers ─────────────────────────────────────────────────────────────
  // Admin `/shipping/carriers` page needs at least one real Carrier row to
  // exercise the edit/save journey. Seed a minimal DHL Express entry.
  await prisma.carrier.upsert({
    where: { code: 'dhl_express' },
    update: {},
    create: {
      id: 'carrier-dhl-express',
      code: 'dhl_express',
      name: { default: 'DHL Express', en: 'DHL Express', fr: 'DHL Express' },
      provider: 'dhl',
      services: ['express', 'economy'],
      zones: [...storeConfig.identity.areaServed],
      isActive: true,
      sortOrder: 10,
      config: {},
    },
  });

  console.log('  Carriers: DHL Express (dhl_express)');

  // ── Promotions ────────────────────────────────────────────────────────────

  await prisma.promotion.upsert({
    where: { couponCode: 'WELCOME10' },
    update: {},
    create: {
      id: 'promo-welcome10',
      name: { default: 'Welcome 10% Off', en: 'Welcome 10% Off', fr: 'Bienvenue, 10% de remise' },
      description: {
        default: 'Use code WELCOME10 for 10% off your first order.',
        en: 'Use code WELCOME10 for 10% off your first order.',
        fr: 'Utilisez le code WELCOME10 pour 10% de remise sur votre première commande.',
      },
      type: 'PERCENTAGE',
      applicationMethod: 'COUPON',
      couponCode: 'WELCOME10',
      value: 10,
      usageLimitPerUser: 1,
      isActive: true,
      priority: 10,
    },
  });

  await prisma.promotion.upsert({
    where: { id: 'promo-freeship' },
    update: {},
    create: {
      id: 'promo-freeship',
      name: {
        default: `Free shipping over ${freeShippingThreshold}`,
        en: `Free shipping over ${freeShippingThreshold}`,
        fr: `Livraison offerte au-dessus de ${freeShippingThreshold}`,
      },
      type: 'FREE_SHIPPING',
      applicationMethod: 'AUTOMATIC',
      value: 0,
      minimumOrderAmount: 300,
      // Seeded inactive (plan K Phase K3). An AUTOMATIC promotion is live the
      // moment it exists, so this row advertised a free-shipping threshold no
      // operator ever configured (finding D4).
      isActive: false,
      priority: 5,
    },
  });

  await prisma.promotion.upsert({
    where: { id: 'promo-buy2' },
    update: {},
    create: {
      id: 'promo-buy2',
      name: {
        default: 'Buy 2, Get 1 Free',
        en: 'Buy 2, Get 1 Free',
        fr: 'Achetez 2 articles, 1 offert',
      },
      type: 'BUY_X_GET_Y',
      applicationMethod: 'AUTOMATIC',
      // Zero, and dormant by contract: the BUY_X_GET_Y engine gives the Y item
      // away free and never reads `value`. It used to be 10, next to a name
      // reading "Buy 2, Get 10% Off", so the cart's discount label advertised
      // ten per cent while the line lost a whole unit. The name now says what
      // the engine does, and `promotions.service.spec.ts` pins the math so a
      // later reading of `value` as a percentage fails a test rather than
      // quietly changing what customers are charged.
      value: 0,
      buyQuantity: 2,
      getQuantity: 1,
      // Seeded inactive (plan K Phase K3). An AUTOMATIC promotion is live the
      // moment it exists, and this one takes a full unit off any two-unit
      // line (finding T3).
      isActive: false,
      priority: 8,
    },
  });

  console.log(
    `  Promotions: WELCOME10 (coupon 10%), free shipping over ${freeShippingThreshold}, buy-2-get-1-free`,
  );

  // ── Gift Card ─────────────────────────────────────────────────────────────

  await prisma.giftCard.upsert({
    where: { code: 'GIFTTEST12345678' },
    update: {},
    create: {
      // The id moves with the code. The upsert keys on `code`, so on a database
      // that still holds the old dashed card the lookup misses and the create
      // runs; keeping the old fixed id there would collide on the primary key.
      // With a new id the create succeeds and the cleanup block further down,
      // which deletes every gift card whose code is not the seeded one, retires
      // the old row in the same run.
      id: 'gc-test-12345678',
      code: 'GIFTTEST12345678',
      initialBalance: 100,
      currentBalance: 100,
      currency: storeConfig.money.currencyCode,
      recipientEmail: 'customer1@test.com',
      recipientName: 'Sam Customer',
      personalMessage: { default: 'Happy Shopping!', en: 'Happy Shopping!', fr: 'Bonne commande.' },
      isActive: true,
    },
  });

  console.log(`  Gift Card: GIFTTEST12345678 (${formatMoney(100, storeConfig.money)})`);

  // ── Storefront Sections ───────────────────────────────────────────────────

  // The five demo sections this file used to plant (section-hero,
  // section-promo, section-featured, section-categories, section-trust) were
  // removed at plan K decision K-D3: they coexisted with a client seeder's real
  // sections and rendered on top of them, which is finding S6, and home
  // sections were declared to belong to the client seed.
  //
  // DR-31 removed the client seed, and with it that home page. A store
  // installed from this tree rendered nothing at all on the first page a
  // customer sees. The default set below is neutral, planted only when the
  // store has no home page of its own, and never overwrites one somebody chose
  // (plan E2.5.2).
  const homeSections = await seedDefaultHomeSections(prisma, storeConfig);
  console.log(
    homeSections.skipped
      ? '  Storefront Sections: home page already configured, left alone'
      : `  Storefront Sections: ${homeSections.planted} default home sections`,
  );

  // ── CMS Pages ─────────────────────────────────────────────────────────────

  const cmsPages = [
    {
      slug: '/about',
      type: 'STATIC' as const,
      title: { default: 'About Us', en: 'About Us', fr: 'À propos' },
      content: { default: 'Learn more about our store and mission.' },
      sortOrder: 0,
    },
    {
      slug: '/contact',
      type: 'STATIC' as const,
      title: { default: 'Contact Us', en: 'Contact Us', fr: 'Nous contacter', ar: 'اتصل بنا' },
      content: { default: 'Get in touch with our team.' },
      sortOrder: 1,
    },
    {
      slug: '/return-policy',
      type: 'POLICY' as const,
      title: {
        default: 'Return Policy',
        en: 'Return Policy',
        fr: 'Politique de retour',
        ar: 'سياسة الإرجاع',
      },
      content: { default: 'Our return and refund policy details.' },
      sortOrder: 2,
    },
    {
      slug: '/privacy-policy',
      type: 'POLICY' as const,
      title: {
        default: 'Privacy Policy',
        en: 'Privacy Policy',
        fr: 'Politique de confidentialité',
        ar: 'سياسة الخصوصية',
      },
      content: { default: 'How we protect your privacy and data.' },
      sortOrder: 3,
    },
    {
      slug: '/terms',
      type: 'POLICY' as const,
      title: { default: 'Terms of Service', en: 'Terms of Service', fr: 'Conditions de service' },
      content: { default: 'Terms and conditions of use.' },
      sortOrder: 4,
    },
    {
      slug: '/shipping-info',
      type: 'POLICY' as const,
      title: {
        default: 'Shipping Information',
        en: 'Shipping Information',
        fr: 'Informations de livraison',
      },
      content: { default: 'Shipping methods, costs, and delivery times.' },
      sortOrder: 5,
    },
    {
      slug: '/faq',
      type: 'STATIC' as const,
      title: { default: 'FAQ', en: 'FAQ', fr: 'Questions fréquentes', ar: 'الأسئلة الشائعة' },
      // Carries one of every tag the write-time sanitizer keeps, so the CMS
      // typography has something to be asserted against. A plain-text body
      // renders identically whether the stylesheet reaches it or not, which
      // is why the missing heading scale and list markers went unnoticed.
      content: {
        default:
          '<h2>Delivery</h2><p>We deliver nationwide.</p>' +
          '<ul><li>Orders leave within two working days.</li>' +
          '<li>Tracking is emailed on dispatch.</li></ul>' +
          '<p>Questions? <a href="/en/pages/contact">Contact us</a>.</p>',
        en:
          '<h2>Delivery</h2><p>We deliver nationwide.</p>' +
          '<ul><li>Orders leave within two working days.</li>' +
          '<li>Tracking is emailed on dispatch.</li></ul>' +
          '<p>Questions? <a href="/en/pages/contact">Contact us</a>.</p>',
        fr:
          '<h2>Livraison</h2><p>Nous livrons dans tout le pays.</p>' +
          '<ul><li>Les commandes partent sous deux jours ouvrés.</li>' +
          "<li>Le suivi est envoyé par e-mail à l'expédition.</li></ul>" +
          '<p>Une question ? <a href="/fr/pages/contact">Contactez-nous</a>.</p>',
      },
      sortOrder: 6,
    },
  ];

  for (const page of cmsPages) {
    await prisma.cmsPage.upsert({
      where: { slug: page.slug },
      update: { title: page.title, content: page.content },
      create: {
        ...page,
        isPublished: true,
        showInNavigation: true,
        metaTitle: Prisma.DbNull,
        metaDescription: Prisma.DbNull,
        template: null,
      },
    });
  }

  console.log('  CMS Pages: 7 default pages');

  // ── Store Settings ────────────────────────────────────────────────────────

  // The identity, localization and money rows come from the runtime config
  // (DR-31): the neutral one on a plain seed, the scenario fixture's when
  // STORE_CONFIG_FIXTURE names one (the fixture seeder at the end writes the
  // full set again, so the two cannot disagree). Only keys registered in
  // SETTINGS_KEYS are written; the unregistered `general.currency`,
  // `general.currencySymbol`, `general.storeEmail` and `general.storePhone`
  // rows this block used to plant were read by nothing.
  const { localization, money } = storeConfig;
  const storeSettings: Array<{ group: string; key: string; value: Prisma.InputJsonValue }> = [
    { group: 'general', key: 'storeName', value: storeConfig.identity.storeName },
    { group: 'localization', key: 'supportedLocales', value: [...localization.supportedLocales] },
    { group: 'localization', key: 'defaultLocale', value: localization.defaultLocale },
    { group: 'localization', key: 'rtlLocales', value: [...localization.rtlLocales] },
    { group: 'localization', key: 'timezone', value: localization.timezone },
    // Mirrors STORE_CONFIG.localization.currencyConfig. Seeded rather than left
    // to the code default so the value is visible in the database, which is
    // where CurrenciesService.getStore reads symbol and decimalPlaces from.
    {
      group: 'localization',
      key: 'currencyConfig',
      value: {
        code: money.currencyCode,
        symbol: money.symbol,
        decimalPlaces: money.displayPrecision,
      },
    },
    // The store currency itself is the currencies module's rows, which the
    // orders and gift card above are written in.
    { group: CURRENCY_ROWS.group, key: CURRENCY_ROWS.defaultKey, value: money.currencyCode },
    { group: CURRENCY_ROWS.group, key: CURRENCY_ROWS.enabledKey, value: [money.currencyCode] },
    // 'exclusive' per plan.md §2.2: the catalogue and cart quote HT and the TTC
    // total appears at checkout. Note this row is a DEAD KNOB — nothing in the
    // repository reads `tax.priceDisplay`, and the engine is tax-exclusive by
    // construction with no priceIncludesTax flag anywhere. It is corrected
    // rather than deleted so it stops asserting the opposite of the decision,
    // and recorded as dead so nobody later "fixes" behaviour by flipping it.
    { group: 'tax', key: 'priceDisplay', value: 'exclusive' },
    { group: 'notifications', key: 'adminEmail', value: 'admin@merchants.test' },
    { group: 'notifications', key: 'orderConfirmation', value: true },
    { group: 'notifications', key: 'shippingUpdates', value: true },
  ];

  for (const s of storeSettings) {
    await prisma.storeSetting.upsert({
      where: { group_key: { group: s.group, key: s.key } },
      update: { value: s.value },
      create: { group: s.group, key: s.key, value: s.value },
    });
  }

  console.log('  Store Settings: general, localization, currency, tax, notifications');

  // ── Cleanup: remove non-seeded E2E test artifacts ─────────────────────────
  // Previous E2E test runs create orders, carts, reviews, users, etc. that
  // accumulate and eventually exhaust finite seed stock. Clean up everything
  // NOT created by this seed so the DB is in a known-good state.

  const seededOrderIds = ['order-1', 'order-2', 'order-3', 'order-4'];
  const seededUserIds = [
    superAdminUser.id,
    managerUser.id,
    supportUser.id,
    adminUser.id,
    staffUser.id,
    customer1.id,
    customer2.id,
  ];

  // Delete non-seeded returns (and their items cascade)
  await prisma.returnItem.deleteMany({ where: { return: { orderId: { notIn: seededOrderIds } } } });
  await prisma.return.deleteMany({ where: { orderId: { notIn: seededOrderIds } } });

  // Delete non-seeded order items, shipments, invoices, then orders
  await prisma.shipment.deleteMany({ where: { orderId: { notIn: seededOrderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { notIn: seededOrderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { notIn: seededOrderIds } } });
  await prisma.promotionUsage.deleteMany({ where: { orderId: { notIn: seededOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { notIn: seededOrderIds } } });

  // Delete non-seeded carts
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({ where: { userId: { notIn: seededUserIds } } });

  // Delete non-seeded reviews
  const seededReviewIds = ['review-1', 'review-2', 'review-3'];
  await prisma.review.deleteMany({ where: { id: { notIn: seededReviewIds } } });

  // Delete non-seeded users (test-generated accounts)
  // Must delete ALL FK references to non-seeded users first.
  // Orders/carts/returns already cleaned above by orderId/cartId, so only leaf FKs remain.
  await prisma.returnItem.deleteMany({
    where: { return: { customerId: { notIn: seededUserIds } } },
  });
  await prisma.return.deleteMany({ where: { customerId: { notIn: seededUserIds } } });
  await prisma.helpfulVote.deleteMany({ where: { userId: { notIn: seededUserIds } } });
  await prisma.review.deleteMany({ where: { userId: { notIn: seededUserIds } } });
  // RefreshToken model dropped in BA5.7 — sessions now owned by Better Auth's
  // `Session` model which cascades on user delete via the prisma schema FK.
  await prisma.address.deleteMany({ where: { userId: { notIn: seededUserIds } } });
  await prisma.notification.deleteMany({ where: { userId: { notIn: seededUserIds } } });
  await prisma.wishlistItem.deleteMany({ where: { userId: { notIn: seededUserIds } } });
  await prisma.user.deleteMany({ where: { id: { notIn: seededUserIds } } });

  // Delete non-seeded gift card transactions & gift cards (keep GIFTTEST12345678)
  await prisma.giftCardTransaction.deleteMany({
    where: { giftCard: { code: { not: 'GIFTTEST12345678' } } },
  });
  await prisma.giftCard.deleteMany({ where: { code: { not: 'GIFTTEST12345678' } } });

  console.log('  Cleanup: removed non-seeded E2E test data');

  // ── Orders ────────────────────────────────────────────────────────────────

  const shippingSnap = {
    fullName: 'Sam Customer',
    phone: '+10000000001',
    addressLine1: 'Villa 12, Street 40',
    addressLine2: 'Sample District',
    city: 'Sample City',
    country: sampleCountry,
    postalCode: '10000',
  };

  const billingSnap = { ...shippingSnap };

  // Order 1: PENDING / PENDING payment
  const order1 = await prisma.order.upsert({
    // Keyed on the stable id, not the order number: AD13 repadded the number
    // from four digits to the generator's six, and an upsert keyed on the old
    // number would miss on an existing database and then collide on this very
    // id. The update converges the number on databases seeded before the change.
    where: { id: 'order-1' },
    // `userId` is converged too, not only the number. `Order.user` is
    // `onDelete: SetNull`, so any run that removes the seeded customer leaves
    // these rows orphaned, and an update that skipped the column left them
    // orphaned forever: the seed then reported a clean re-seed while
    // `admin-wrong-data.e2e-spec.ts` read `orderCount: 0`.
    update: { orderNumber: seedOrderNumber(1), userId: customer1.id },
    create: {
      id: 'order-1',
      orderNumber: seedOrderNumber(1),
      userId: customer1.id,
      status: 'PENDING',
      paymentStatus: 'PENDING',
      shippingAddress: shippingSnap,
      billingAddress: billingSnap,
      subtotal: 4299,
      shippingAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      total: 4299,
      shippingMethodName: `Free shipping over ${freeShippingThreshold}`,
      currency: storeConfig.money.currencyCode,
    },
  });

  await prisma.orderItem.upsert({
    where: { id: 'oi-1-1' },
    update: {},
    create: {
      id: 'oi-1-1',
      orderId: order1.id,
      variantId: 'var-iphone-128-blk',
      productId: 'prod-iphone',
      productName: { default: 'iPhone 15 Pro', en: 'iPhone 15 Pro', fr: 'iPhone 15 Pro' },
      variantLabel: '128GB / Black',
      sku: 'IPH15PRO-128-BLK',
      unitPrice: 4299,
      quantity: 1,
      total: 4299,
      weight: 0.187,
    },
  });

  // Order 2: CONFIRMED / CAPTURED payment
  const order2 = await prisma.order.upsert({
    // Keyed on the stable id, not the order number: AD13 repadded the number
    // from four digits to the generator's six, and an upsert keyed on the old
    // number would miss on an existing database and then collide on this very
    // id. The update converges the number on databases seeded before the change.
    where: { id: 'order-2' },
    // `userId` is converged too, not only the number. `Order.user` is
    // `onDelete: SetNull`, so any run that removes the seeded customer leaves
    // these rows orphaned, and an update that skipped the column left them
    // orphaned forever: the seed then reported a clean re-seed while
    // `admin-wrong-data.e2e-spec.ts` read `orderCount: 0`.
    update: { orderNumber: seedOrderNumber(2), userId: customer1.id },
    create: {
      id: 'order-2',
      orderNumber: seedOrderNumber(2),
      userId: customer1.id,
      status: 'CONFIRMED',
      paymentStatus: 'CAPTURED',
      shippingAddress: shippingSnap,
      billingAddress: billingSnap,
      subtotal: 238,
      shippingAmount: 0,
      taxAmount: 0,
      discountAmount: 23.8,
      total: 214.2,
      couponCode: 'WELCOME10',
      shippingMethodName: `Free shipping over ${freeShippingThreshold}`,
      currency: storeConfig.money.currencyCode,
    },
  });

  await prisma.orderItem.upsert({
    where: { id: 'oi-2-1' },
    update: {},
    create: {
      id: 'oi-2-1',
      orderId: order2.id,
      variantId: 'var-ts-m-blk',
      productId: 'prod-tshirt',
      productName: {
        default: 'Premium Cotton T-Shirt',
        en: 'Premium Cotton T-Shirt',
        fr: 'T-shirt en coton premium',
      },
      variantLabel: 'M / Black',
      sku: 'TS-COT-M-BLK',
      unitPrice: 89,
      quantity: 1,
      total: 89,
      weight: 0.2,
    },
  });

  await prisma.orderItem.upsert({
    where: { id: 'oi-2-2' },
    update: {},
    create: {
      id: 'oi-2-2',
      orderId: order2.id,
      variantId: 'var-polo-m-red',
      productId: 'prod-polo',
      productName: {
        default: 'Classic Piqué Polo Shirt',
        en: 'Classic Piqué Polo Shirt',
        fr: 'Polo classique en piqué',
      },
      variantLabel: 'M / Red',
      sku: 'POLO-M-RED',
      unitPrice: 149,
      quantity: 1,
      total: 149,
      weight: 0.25,
    },
  });

  // Order 3: SHIPPED / CAPTURED
  const shippingSnap2 = {
    fullName: 'Sara Hassan',
    phone: '+10000000002',
    addressLine1: 'Apt 8B, Tower 3',
    addressLine2: 'Marina District',
    city: 'Sample Harbour',
    country: sampleCountry,
    postalCode: '10001',
  };

  const order3 = await prisma.order.upsert({
    // Keyed on the stable id, not the order number: AD13 repadded the number
    // from four digits to the generator's six, and an upsert keyed on the old
    // number would miss on an existing database and then collide on this very
    // id. The update converges the number on databases seeded before the change.
    where: { id: 'order-3' },
    // `userId` is converged too, not only the number. `Order.user` is
    // `onDelete: SetNull`, so any run that removes the seeded customer leaves
    // these rows orphaned, and an update that skipped the column left them
    // orphaned forever: the seed then reported a clean re-seed while
    // `admin-wrong-data.e2e-spec.ts` read `orderCount: 0`.
    update: { orderNumber: seedOrderNumber(3), userId: customer2.id },
    create: {
      id: 'order-3',
      orderNumber: seedOrderNumber(3),
      userId: customer2.id,
      status: 'SHIPPED',
      paymentStatus: 'CAPTURED',
      shippingAddress: shippingSnap2,
      billingAddress: shippingSnap2,
      subtotal: 1499,
      shippingAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      total: 1499,
      shippingMethodName: `Free shipping over ${freeShippingThreshold}`,
      currency: storeConfig.money.currencyCode,
    },
  });

  await prisma.orderItem.upsert({
    where: { id: 'oi-3-1' },
    update: {},
    create: {
      id: 'oi-3-1',
      orderId: order3.id,
      variantId: 'var-hp-blk',
      productId: 'prod-headphones',
      productName: {
        default: 'Sony WH-1000XM5 Headphones',
        en: 'Sony WH-1000XM5 Headphones',
        fr: 'Casque Sony WH-1000XM5',
      },
      variantLabel: 'Black',
      sku: 'SONY-XM5-BLK',
      unitPrice: 1499,
      quantity: 1,
      total: 1499,
      weight: 0.25,
    },
  });

  await prisma.shipment.upsert({
    where: { id: 'ship-3-1' },
    update: {},
    create: {
      id: 'ship-3-1',
      orderId: order3.id,
      carrier: 'Sample Post',
      trackingNumber: 'SP2026001234',
      status: 'SHIPPED',
      shippedAt: new Date('2026-04-02T10:00:00Z'),
      items: [{ orderItemId: 'oi-3-1', quantity: 1 }],
    },
  });

  // Order 4: DELIVERED / CAPTURED
  const order4 = await prisma.order.upsert({
    // Keyed on the stable id, not the order number: AD13 repadded the number
    // from four digits to the generator's six, and an upsert keyed on the old
    // number would miss on an existing database and then collide on this very
    // id. The update converges the number on databases seeded before the change.
    where: { id: 'order-4' },
    // `userId` is converged too, not only the number. `Order.user` is
    // `onDelete: SetNull`, so any run that removes the seeded customer leaves
    // these rows orphaned, and an update that skipped the column left them
    // orphaned forever: the seed then reported a clean re-seed while
    // `admin-wrong-data.e2e-spec.ts` read `orderCount: 0`.
    update: { orderNumber: seedOrderNumber(4), userId: customer2.id },
    create: {
      id: 'order-4',
      orderNumber: seedOrderNumber(4),
      userId: customer2.id,
      status: 'DELIVERED',
      paymentStatus: 'CAPTURED',
      shippingAddress: shippingSnap2,
      billingAddress: shippingSnap2,
      subtotal: 527,
      shippingAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      total: 527,
      shippingMethodName: `Free shipping over ${freeShippingThreshold}`,
      currency: storeConfig.money.currencyCode,
    },
  });

  await prisma.orderItem.upsert({
    where: { id: 'oi-4-1' },
    update: {},
    create: {
      id: 'oi-4-1',
      orderId: order4.id,
      variantId: 'var-shoes-42',
      productId: 'prod-shoes',
      productName: {
        default: 'Urban Runner Sneakers',
        en: 'Urban Runner Sneakers',
        fr: 'Baskets Urban Runner',
      },
      variantLabel: 'Size 42',
      sku: 'SHOE-URB-42',
      unitPrice: 349,
      quantity: 1,
      total: 349,
      weight: 0.8,
    },
  });

  await prisma.orderItem.upsert({
    where: { id: 'oi-4-2' },
    update: {},
    create: {
      id: 'oi-4-2',
      orderId: order4.id,
      variantId: 'var-backpack',
      productId: 'prod-backpack',
      productName: {
        default: 'Canvas City Backpack',
        en: 'Canvas City Backpack',
        fr: 'Sac à dos urbain en toile',
      },
      variantLabel: null,
      sku: 'BKPK-CVS-20L',
      unitPrice: 289,
      quantity: 1,
      total: 289,
      weight: 0.65,
    },
  });

  await prisma.shipment.upsert({
    where: { id: 'ship-4-1' },
    update: {},
    create: {
      id: 'ship-4-1',
      orderId: order4.id,
      carrier: 'Sample Post',
      trackingNumber: 'SP2026000987',
      status: 'DELIVERED',
      shippedAt: new Date('2026-03-25T09:00:00Z'),
      deliveredAt: new Date('2026-03-27T14:30:00Z'),
      items: [
        { orderItemId: 'oi-4-1', quantity: 1 },
        { orderItemId: 'oi-4-2', quantity: 1 },
      ],
    },
  });

  // ── Order status history ──────────────────────────────────────────────────
  // The seeded orders predate `OrderStatusHistory` and are written with plain
  // upserts, so nothing else gives them a timeline. The storefront no longer
  // synthesises one from `{ status, createdAt }` (plan M phase M2, finding
  // AD6), so without this a fresh dev database renders every seeded order with
  // an EMPTY timeline, which is the lane a human uses to eyeball the fix.
  //
  // Real offsets rather than the backfill's `createdAt + 1 millisecond` guard:
  // that guard exists to keep a backfilled row from predating its order, and on
  // seed data, whose `updatedAt` never moved, it produces "delivered one
  // millisecond after it was placed" — the same fiction the plan refuses.
  // Here the seed owns the clock, so it can tell the truth.
  //
  // Idempotent the same way the backfill is: an order that already holds any
  // history row is skipped whole.
  const STATUS_WALK: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
  const DAY_MS = 24 * 60 * 60 * 1000;

  for (const order of [order1, order2, order3, order4]) {
    const already = await prisma.orderStatusHistory.count({ where: { orderId: order.id } });
    if (already > 0) continue;

    const target = STATUS_WALK.indexOf(order.status);
    // Every seeded order sits on the happy path; anything else gets its birth
    // row only, which is still honest.
    const walk = target > 0 ? STATUS_WALK.slice(0, target + 1) : ['PENDING' as OrderStatus];
    // A day per step unless that runs past now: an order created by this seed
    // run would get future rows, and every real transition after them would
    // sort before them and hide the current status.
    const elapsed = Date.now() - order.createdAt.getTime();
    const step = Math.max(1, Math.min(DAY_MS, Math.floor(elapsed / walk.length)));

    for (const [i, toStatus] of walk.entries()) {
      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: i === 0 ? null : walk[i - 1],
          toStatus,
          createdAt: new Date(order.createdAt.getTime() + i * step),
        },
      });
    }
  }

  console.log('  Orders: 4 (PENDING, CONFIRMED, SHIPPED, DELIVERED) with items & shipments');
  console.log('  Order status history: seeded per order, one row per transition');

  // ── Return ────────────────────────────────────────────────────────────────

  // `requestedAt` must be set explicitly, and in `update` too: it defaults to
  // now() at seed time, so without this the timeline read "approved two months
  // before requested" and databases seeded earlier would keep the bad row.
  const ret1RequestedAt = new Date('2026-03-24T09:00:00Z');
  const ret1 = await prisma.return.upsert({
    where: { returnNumber: 'RET-2026-0001' },
    update: { requestedAt: ret1RequestedAt },
    create: {
      id: 'return-1',
      returnNumber: 'RET-2026-0001',
      orderId: order4.id,
      customerId: customer2.id,
      status: 'REFUND_PROCESSED',
      reason: 'WRONG_SIZE',
      reasonDetail: 'Size 42 runs small; fits like a 41.',
      refundMethod: 'ORIGINAL_PAYMENT',
      refundAmount: 349,
      requestedAt: ret1RequestedAt,
      approvedAt: new Date('2026-03-29T10:00:00Z'),
      receivedAt: new Date('2026-03-31T12:00:00Z'),
      refundedAt: new Date('2026-04-01T09:00:00Z'),
    },
  });

  await prisma.returnItem.upsert({
    where: { id: 'ri-1-1' },
    update: {},
    create: {
      id: 'ri-1-1',
      returnId: ret1.id,
      orderItemId: 'oi-4-1',
      variantId: 'var-shoes-42',
      quantity: 1,
      restockDecision: 'RESTOCK',
      notes: 'Item in perfect condition.',
    },
  });

  console.log('  Return: RET-2026-0001 (shoes, REFUND_PROCESSED, restocked)');

  // ── Reviews ───────────────────────────────────────────────────────────────

  await prisma.review.upsert({
    where: { productId_userId: { productId: 'prod-iphone', userId: customer1.id } },
    update: {},
    create: {
      id: 'review-1',
      productId: 'prod-iphone',
      userId: customer1.id,
      title: { default: 'Best phone I have ever owned', en: 'Best phone I have ever owned' },
      body: {
        default:
          'The A17 Pro chip is blazing fast and the titanium build feels incredibly premium. Battery life is excellent and the camera quality is stunning.',
        en: 'The A17 Pro chip is blazing fast and the titanium build feels incredibly premium. Battery life is excellent and the camera quality is stunning.',
      },
      rating: 5,
      status: 'PUBLISHED',
      verifiedPurchase: false,
      locale: 'en',
    },
  });

  await prisma.review.upsert({
    where: { productId_userId: { productId: 'prod-headphones', userId: customer2.id } },
    update: {},
    create: {
      id: 'review-2',
      productId: 'prod-headphones',
      userId: customer2.id,
      title: { default: 'Exceptional noise cancellation', en: 'Exceptional noise cancellation' },
      body: {
        default:
          'These headphones block out virtually all ambient noise. The sound quality is warm and detailed. Highly recommended for frequent travellers.',
        en: 'These headphones block out virtually all ambient noise. The sound quality is warm and detailed. Highly recommended for frequent travellers.',
      },
      rating: 5,
      status: 'PUBLISHED',
      verifiedPurchase: true,
      locale: 'en',
    },
  });

  await prisma.review.upsert({
    where: { productId_userId: { productId: 'prod-shoes', userId: customer2.id } },
    update: {},
    create: {
      id: 'review-3',
      productId: 'prod-shoes',
      userId: customer2.id,
      title: { default: 'Comfortable but runs small', en: 'Comfortable but runs small' },
      body: {
        default:
          'Great looking shoes and very comfortable once you get the right size. I recommend sizing up by half a size. The foam midsole is very responsive.',
        en: 'Great looking shoes and very comfortable once you get the right size. I recommend sizing up by half a size. The foam midsole is very responsive.',
      },
      rating: 3,
      status: 'PENDING',
      verifiedPurchase: true,
      locale: 'en',
    },
  });

  console.log('  Reviews: 3 (2 PUBLISHED, 1 PENDING)');

  // ── Sequence Counters ────────────────────────────────────────────────────

  await prisma.sequenceCounter.upsert({
    where: { name_year: { name: 'order', year: currentYear } },
    update: {},
    create: { name: 'order', year: currentYear, value: SEEDED_ORDER_COUNT },
  });

  await prisma.sequenceCounter.upsert({
    where: { name_year: { name: 'return', year: currentYear } },
    update: {},
    create: { name: 'return', year: currentYear, value: 1 },
  });

  await prisma.sequenceCounter.upsert({
    where: { name_year: { name: 'invoice', year: currentYear } },
    update: {},
    create: { name: 'invoice', year: currentYear, value: 0 },
  });

  console.log(`  Sequence Counters: order=${SEEDED_ORDER_COUNT}, return=1, invoice=0`);

  // ── Reserve the seeded order numbers in the generator's sequence ──────────
  // The `SequenceCounter` rows above are NOT what numbers a real order.
  // `OrdersService.generateOrderNumber` draws from a Postgres sequence,
  // `order_seq_<year>`, created START WITH 1 (orders.service.ts nextSequenceValue).
  //
  // Before plan K Phase K3 the seed wrote four-digit numbers (ORD-2026-0001),
  // so the seeded rows and the generated ones lived in different namespaces and
  // the collision never surfaced. Padding the seed to the generator's six digits
  // (finding AD13) puts them in the SAME namespace, and the first order placed
  // on a freshly seeded database would then be handed ORD-2026-000001 again and
  // die on the unique index.
  //
  // So the seed reserves what it just used. GREATEST never rewinds a sequence
  // that is already ahead, which matters on a long-lived test database.
  // Raw SQL because the sequence is not a Prisma model; the generator reaches
  // for it the same way.
  const orderSeqName = `order_seq_${currentYear}`;
  await prisma.$executeRawUnsafe(
    `CREATE SEQUENCE IF NOT EXISTS "${orderSeqName}" START WITH 1 INCREMENT BY 1`,
  );
  await prisma.$queryRawUnsafe(
    `SELECT setval('"${orderSeqName}"', GREATEST((SELECT last_value FROM "${orderSeqName}"), ${SEEDED_ORDER_COUNT}), true)`,
  );
  console.log(`  Order sequence: ${orderSeqName} reserved through ${SEEDED_ORDER_COUNT}`);

  // ── E2E catalogue (incremental, idempotent) ───────────────────────────────
  // OPT-IN since plan K Phase K3. This used to run by default, which meant
  // every fresh dev or test database was born carrying a previous client's
  // catalogue, promotions and home sections (finding X1, and H6's copy). The
  // one harness that genuinely needs that catalogue, the storefront e2e suite,
  // opts in explicitly; plan E2.6 replaces it with a brandless fixture
  // catalogue and retires this block with it.
  if (process.env.FIXTURE_CATALOGUE_SEED === '1') {
    console.log('\n  E2E catalogue: seeding the storefront e2e catalogue…');
    // That module graph transitively imports
    // `apps/api/src/modules/assets/assets.constants.ts`, which uses the
    // `@common/asset-variants` tsconfig path alias. ts-node does not honour
    // `paths` from tsconfig.base.json on its own, so register the workspace
    // aliases here before the dynamic import resolves. Mirrors the in-CLI
    // registration in that seed's own cli.ts.
    const { register } = await import('tsconfig-paths');
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- a JSON file read at run time
    const baseConfig = require(path.resolve(__dirname, '..', 'tsconfig.base.json'));
    register({
      baseUrl: path.resolve(__dirname, '..'),
      paths: baseConfig.compilerOptions?.paths ?? {},
    });
    const { seedFixtureCatalogue } = await import('./seeds/fixture-catalogue');
    const summary = await seedFixtureCatalogue({
      prisma,
      currency: storeConfig.money.currencyCode,
      localization: storeConfig.localization,
      identity: storeConfig.identity,
    });
    console.log(
      `  E2E catalogue: ${summary.categories} categories, ${summary.products} products, ${summary.reviews} reviews, ${summary.questions} Q&A, ${summary.promotions} promotions, ${summary.giftCards} gift card, customer ${summary.customer.id}`,
    );
  }

  // ── Shipping from the runtime config, LAST on purpose ─────────────────────
  // The e2e catalogue block above re-plants its own zone and takes `isDefault`
  // back with a full `update` payload, so anything seeded before it loses.
  // Running the config seed here means the store default is the config's
  // domestic method whichever blocks ran, and its own retire step soft-deletes
  // the rows earlier client-shaped seeds left. Ordering, not preference:
  // seeded earlier this call is silently undone a few hundred lines later.
  {
    const shipping = await seedShipping(prisma, storeConfig, { flatRate: seedFlatRate() });
    console.log(
      shipping
        ? `  Shipping: ${shipping.methodId} @ ${formatMoney(shipping.price, storeConfig.money)} (default)`
        : '  Shipping: no country configured, no zone seeded',
    );
  }

  // ── NotificationTemplate seeds (mail module — Resend rollout) ───────────────
  // One row per MailJobName. Operator-editable from the admin notifications
  // UI; the mail module's file-based renderer is the fallback when a row is
  // missing or its body is empty (post-NE1, `isEnabled` no longer governs
  // content selection). Subject + body are Translatable JSONB ({ fr, en }).
  await seedNotificationTemplates(prisma, storeConfig.localization.supportedLocales);
  console.log('  NotificationTemplates: 36 flow codes upserted');

  // ── Scenario store config (E0.4, DR-31) ─────────────────────────────────────
  // Last, so the fixture overrides every settings row seeded above. Opt-in via
  // STORE_CONFIG_FIXTURE until the storefront and admin derive their locale
  // and money assertions from the active fixture (E1 to E3).
  if (process.env[STORE_CONFIG_FIXTURE_ENV]) {
    const fixture = activeStoreConfigFixture();
    const written = await seedStoreConfigFixture(prisma, fixture);
    console.log(`  StoreConfig: fixture ${fixture.fixture.id} wrote ${written} settings rows`);
  }

  await flushMoneyCache();

  console.log('\nSeeding finished.');
}

/**
 * Idempotent upsert of every transactional template. Since NE3 the subject +
 * body + variables come from the canonical `TEMPLATE_DEFAULTS` (real fr/en
 * body-only blocks the renderer composes into the brand layout), so fresh DBs
 * are seeded with live content, not blanks. The TS file templates in
 * `apps/api/src/modules/mail/templates/` remain the compile-checked fallback.
 * The `update: {}` branch never overwrites an operator edit on re-seed; older
 * rows seeded blank before NE3 are repaired idempotently by
 * `backfill-notification-bodies.ts`.
 *
 * The list below carries routing only: code, event, category, isLocked. It used
 * to carry a subject, a body and a variable list per code as well; all 36 were
 * dead, because every code has a `TEMPLATE_DEFAULTS` entry (D7.40).
 */
/**
 * Keeps `default` plus the locales the store ships. The defaults file carries
 * every catalogue locale; a stored template must not, because the Translatable
 * DTOs refuse a value for a locale the store has not enabled (plan E1.3.4) and
 * the admin round-trips a template with every key it holds.
 */
function localeSubset(
  value: Record<string, string>,
  locales: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key === 'default' || locales.includes(key)),
  );
}

async function seedNotificationTemplates(
  prisma: PrismaClient,
  locales: readonly string[],
): Promise<void> {
  const templates: Array<{
    code: string;
    event: string;
    category?: string;
    isLocked?: boolean;
  }> = [
    {
      code: 'auth.password-reset',
      event: 'auth.password_reset_requested',
    },
    {
      code: 'auth.email-verification',
      event: 'auth.email_verification_requested',
    },
    {
      code: 'auth.magic-link',
      event: 'auth.magic_link_requested',
    },
    {
      code: 'auth.change-email-verification',
      event: 'auth.change_email_requested',
    },
    {
      code: 'auth.delete-account',
      event: 'auth.delete_account_requested',
    },
    {
      code: 'auth.password-changed',
      event: 'users.password-changed',
    },
    {
      code: 'auth.email-change-alert',
      event: 'auth.change_email_requested',
    },
    {
      code: 'customer.welcome',
      event: 'user.email_verified',
    },
    {
      code: 'order.placed',
      event: 'order.created',
    },
    {
      code: 'order.shipped',
      event: 'order.shipped',
    },
    {
      code: 'order.delivered',
      event: 'order.delivered',
    },
    {
      code: 'order.cancelled',
      event: 'order.cancelled',
    },
    {
      code: 'giftcard.purchase',
      event: 'giftcard.purchased',
    },
    {
      code: 'giftcard.redeemed',
      event: 'giftcard.redeemed',
    },
    {
      code: 'admin.staff-invite',
      event: 'admin.user_invited',
    },
    {
      code: 'contact-form',
      event: 'storefront.contact_submitted',
    },
    {
      code: 'giftcard.store-credit',
      event: 'giftcard.store-credit-issued',
    },
    {
      code: 'cart.abandoned',
      event: 'cart.abandoned',
      // Marketing/lifecycle (NE5 Decision 2): the NE7 consent gate will require
      // opt-in. Sends ungated in the NE5→NE7 interim.
      category: 'LIFECYCLE',
    },
    {
      code: 'question.answered',
      event: 'question.answered',
    },
    {
      code: 'review.approved',
      event: 'review.approved',
    },
    {
      code: 'order.confirmed',
      event: 'order.confirmed',
    },
    {
      code: 'order.exchange-created',
      event: 'return.exchange-created',
    },
    {
      code: 'return.requested',
      event: 'return.created',
    },
    {
      code: 'return.approved',
      event: 'return.approved',
    },
    {
      code: 'return.rejected',
      event: 'return.rejected',
    },
    {
      code: 'return.received',
      event: 'return.received',
    },
    {
      code: 'return.refunded',
      event: 'return.refunded',
      // Refund confirmation is non-disableable (plan §3b).
      isLocked: true,
    },

    // ── NE8 — staff digests + scheduled lifecycle flows ───────────────────────
    {
      code: 'product.back-in-stock',
      event: 'inventory.restocked',
      // Wishlist-driven restock notice — consent-gated lifecycle mail (NE7 gate).
      category: 'LIFECYCLE',
    },
    {
      code: 'review.request',
      event: 'order.delivered',
      // Post-delivery review solicitation — consent-gated lifecycle mail (O8).
      category: 'LIFECYCLE',
    },
    {
      code: 'giftcard.expiry-reminder',
      event: 'giftcard.expiry_reminder',
    },
    {
      code: 'auth.2fa-otp',
      event: 'auth.2fa_otp_requested',
    },
    {
      code: 'auth.2fa-enabled',
      event: 'auth.2fa_enabled',
    },
    {
      code: 'auth.2fa-disabled',
      event: 'auth.2fa_disabled',
    },
    {
      code: 'admin.ops-digest',
      event: 'admin.ops_digest',
    },
    {
      code: 'admin.kpi-digest',
      event: 'admin.kpi_digest',
    },

    // ── NE9 — marketing / broadcast plane ─────────────────────────────────────
    {
      code: 'newsletter.confirm',
      event: 'newsletter.confirm_requested',
      // Double opt-in confirmation — TRANSACTIONAL (it is the opt-in mechanism, so
      // it must send without prior marketing consent).
      category: 'TRANSACTIONAL',
    },
  ];

  for (const tpl of templates) {
    // D7.40: `TEMPLATE_DEFAULTS` is the only source of subject + body +
    // variables. A code with no default used to seed a silent empty row that
    // nobody maintained, so a missing default is now a seed failure.
    const defaults = TEMPLATE_DEFAULTS[tpl.code as MailFlowCode];
    if (!defaults) {
      throw new Error(
        `seedNotificationTemplates: no TEMPLATE_DEFAULTS entry for '${tpl.code}'. Add it to prisma/notification-template-defaults.ts.`,
      );
    }

    await prisma.notificationTemplate.upsert({
      where: { code: tpl.code },
      // Don't overwrite operator edits on re-seed. Only create-on-miss.
      update: {},
      create: {
        code: tpl.code,
        event: tpl.event,
        channel: 'email',
        subject: localeSubset(defaults.subject, locales),
        body: localeSubset(defaults.body, locales),
        variables: defaults.variables,
        isEnabled: false, // legacy content flag — superseded by sendEnabled + non-empty body (NE1)
        sendEnabled: true, // NE1 kill-switch — every flow ships enabled
        // Most flows are transactional; cart.abandoned + future marketing flows
        // opt into LIFECYCLE/MARKETING (NE5 Decision 2, gated at NE7).
        category: tpl.category ?? 'TRANSACTIONAL',
        // Non-disableable security/legal flows (operator decision 2 + plan §3b
        // refund-confirmation). auth.*/order.* lock by prefix; others opt in.
        isLocked: tpl.isLocked ?? (tpl.code.startsWith('auth.') || tpl.code.startsWith('order.')),
      },
    });
  }
}

main()
  .then(async () => {
    // NOTE: the FTS index (searchVector + trigger + indexes + backfill) is NOT
    // applied here. It needs the DB superuser (CREATE EXTENSION / function
    // ownership), whereas prod seeds run as the unprivileged `merchants_app`
    // role. It is applied as `postgres` by the dedicated FTS step that runs
    // BEFORE the seed (CI migrate-db, provision step 7b) — so the trigger is
    // already live when these rows insert. Dev: `npm run db:setup` (push + fts)
    // or `npm run db:fts`. E2e: handled by test/e2e-global-setup.ts.
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
