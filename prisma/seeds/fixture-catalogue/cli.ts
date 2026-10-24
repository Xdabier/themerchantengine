import * as path from 'path';
import * as dotenv from 'dotenv';
import { register } from 'tsconfig-paths';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

// Register the workspace path aliases (`@common/*` etc.) so transitive
// imports from `apps/api/src/**` resolve when ts-node compiles the seed
// module graph. Without this, `assets.constants.ts` → `@common/asset-variants`
// fails with MODULE_NOT_FOUND because ts-node does not honour `paths` from
// tsconfig.base.json on its own.
// eslint-disable-next-line @typescript-eslint/no-var-requires -- a JSON file read at run time
const baseConfig = require(path.resolve(__dirname, '..', '..', '..', 'tsconfig.base.json'));
register({
  baseUrl: path.resolve(__dirname, '..', '..', '..'),
  paths: baseConfig.compilerOptions?.paths ?? {},
});

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { storeConfigFromSettingRows } from '../../../libs/shared/common/src/store-config';
import { seedFixtureCatalogue } from './index';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed the fixture catalogue');
  }
  const adapter = new PrismaPg(databaseUrl);
  const prisma = new PrismaClient({ adapter });

  try {
    // The catalogue is priced in whatever the store is configured for, read
    // from the settings rows the config seed wrote (DR-31).
    const storeConfig = storeConfigFromSettingRows(
      await prisma.storeSetting.findMany({ select: { group: true, key: true, value: true } }),
    );
    const summary = await seedFixtureCatalogue({
      prisma,
      currency: storeConfig.money.currencyCode,
      localization: storeConfig.localization,
      identity: storeConfig.identity,
    });
    console.log('\n[fixture-catalogue] summary:');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[fixture-catalogue] seed failed:', err);
  process.exit(1);
});
