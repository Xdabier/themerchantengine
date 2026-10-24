/* eslint-disable */
/**
 * Backend e2e configuration.
 *
 * The suite runs OUT OF PROCESS: a webpack-bundled API instance on port 53001
 * (started by `e2e-global-setup.ts`) against the dockerised test stack. Specs
 * are HTTP clients plus a standalone Prisma client — jest never imports the
 * NestJS app, so Better Auth's ESM-only packaging never reaches jest's CJS
 * runtime.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

/**
 * Which scenario store config the e2e database was seeded from (plan E0.4).
 * `null` means STORE_CONFIG_FIXTURE was unset and the seed's own defaults are
 * active. The helpers live in the shared loader.
 */
export {
  DEFAULT_STORE_CONFIG_FIXTURE,
  describeHarnessStoreConfig,
  harnessStoreConfigFixture,
  harnessStoreConfigFixtureId,
  loadStoreConfigFixture,
  type StoreConfigFixture,
} from '../../libs/shared/common/src/store-config-fixtures';

/** Base URL of the e2e API instance. */
export const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:53001';

/** Test database connection string — never the dev database. */
export const TEST_DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  'postgresql://postgres:postgres@localhost:55433/merchants_engine_test';

/** Test Redis. */
export const TEST_REDIS_HOST = process.env.REDIS_TEST_HOST ?? 'localhost';
export const TEST_REDIS_PORT = Number(process.env.REDIS_TEST_PORT ?? 56380);

/** Better Auth secret for the e2e instance. */
export const E2E_BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? 'e2e-better-auth-secret-min-32-bytes-of-padding';

/** Stripe webhook signing secret for the e2e instance; specs sign events with it. */
export const E2E_STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_e2e_signing_secret';
