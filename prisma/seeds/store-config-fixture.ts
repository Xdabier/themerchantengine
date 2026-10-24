/**
 * Seeds the StoreSetting rows of a scenario store config (plan E0.4 and E1.1,
 * DR-31). Runs from prisma/seed.ts when STORE_CONFIG_FIXTURE is set, after the
 * baseline settings, so the fixture wins. The row mapping is the shared
 * `storeConfigSettingRows`, the same one the API's `StoreConfigComposer` and
 * the CLI stepper write through, so every key has exactly one home.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { isProduction } from '../../libs/shared/common/src/env/runtime-environment';
import {
  runtimeConfigOfFixture,
  type StoreConfigFixture,
  type StoreRuntimeConfig,
} from '../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import {
  CURRENCY_ROWS,
  storeConfigSettingRows,
  type StoreSettingRow as SharedStoreSettingRow,
} from '../../libs/shared/common/src/store-config/store-config-rows';

export { CURRENCY_ROWS };

export interface StoreSettingRow extends SharedStoreSettingRow {
  value: Prisma.InputJsonValue;
}

/** Pure mapping from a runtime config to the settings rows that hold it. */
export function storeConfigRowsOf(config: StoreRuntimeConfig): StoreSettingRow[] {
  return storeConfigSettingRows(config).map((row) => ({
    ...row,
    // `StoreSetting.value` is a non-nullable Json column; a null claim (no
    // logo asset, no secondary colour) is stored as JSON null on purpose.
    value: (row.value === null ? Prisma.JsonNull : row.value) as Prisma.InputJsonValue,
  }));
}

/** Pure mapping from a fixture to the settings rows it seeds. */
export function storeConfigFixtureSettingRows(fixture: StoreConfigFixture): StoreSettingRow[] {
  return storeConfigRowsOf(runtimeConfigOfFixture(fixture));
}

/**
 * Upserts the rows of a real store's config, the one the install stepper
 * wrote to `client.config.json` (plan E4.4). No production guard: unlike a
 * fixture, this is the store's own identity, and the stepper is the party
 * that writes it. Returns how many rows it wrote.
 */
export async function seedStoreConfig(
  prisma: PrismaClient,
  config: StoreRuntimeConfig,
): Promise<number> {
  const rows = storeConfigRowsOf(config);
  for (const row of rows) {
    await prisma.storeSetting.upsert({
      where: { group_key: { group: row.group, key: row.key } },
      create: row,
      update: { value: row.value },
    });
  }
  return rows.length;
}

/**
 * The public logo URL the stepper uploaded (`STORE_LOGO_URL`), written to
 * `appearance.logoUrl`, the key the admin shell and the storefront read.
 * Written once: an operator who replaces the logo in the admin keeps theirs.
 */
export async function seedLogoUrl(prisma: PrismaClient, logoUrl: string): Promise<boolean> {
  const existing = await prisma.storeSetting.findUnique({
    where: { group_key: { group: 'appearance', key: 'logoUrl' } },
    select: { value: true },
  });
  if (existing && existing.value !== '') return false;
  await prisma.storeSetting.upsert({
    where: { group_key: { group: 'appearance', key: 'logoUrl' } },
    create: { group: 'appearance', key: 'logoUrl', value: logoUrl },
    update: { value: logoUrl },
  });
  return true;
}

/** Set alongside STORE_CONFIG_FIXTURE to let a fixture overwrite a production store's config. */
export const STORE_CONFIG_FIXTURE_FORCE_ENV = 'STORE_CONFIG_FIXTURE_FORCE';

/**
 * Upserts every row; returns how many it wrote.
 *
 * A fixture rewrites identity, locales, currency and public origins, so in
 * production it is refused unless the operator also sets
 * STORE_CONFIG_FIXTURE_FORCE: a shell that still exports the test variable
 * must not reset a live store on `prisma db seed`.
 */
export function assertFixtureAllowed(
  fixtureId: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isProduction(env) && env[STORE_CONFIG_FIXTURE_FORCE_ENV] !== '1') {
    throw new Error(
      `Refusing to seed the ${fixtureId} store config fixture in production; set ${STORE_CONFIG_FIXTURE_FORCE_ENV}=1 to overwrite this store's config on purpose.`,
    );
  }
}

export async function seedStoreConfigFixture(
  prisma: PrismaClient,
  fixture: StoreConfigFixture,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  assertFixtureAllowed(fixture.fixture.id, env);
  const rows = storeConfigFixtureSettingRows(fixture);
  for (const row of rows) {
    await prisma.storeSetting.upsert({
      where: { group_key: { group: row.group, key: row.key } },
      create: row,
      update: { value: row.value },
    });
  }
  return rows.length;
}
