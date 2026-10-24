import * as fs from 'node:fs';
import {
  storeRuntimeConfigSchema,
  type StoreRuntimeConfig,
} from '../store-config-fixtures/store-config-fixture.schema';

/**
 * The store config the install stepper writes (`client.config.json`, plan
 * E4.2) and the seed reads (plan E4.4). Same strict schema as the public
 * endpoint and the scenario fixtures, so a key the stepper misspells fails
 * here rather than seeding a row nothing reads.
 *
 * `STORE_CONFIG_FILE` names the file for `prisma db seed`; it plays the role
 * `STORE_CONFIG_FIXTURE` plays for the test harnesses, for a real store.
 */
export const STORE_CONFIG_FILE_ENV = 'STORE_CONFIG_FILE';

export function parseStoreConfigFile(raw: string, source: string): StoreRuntimeConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  const parsed = storeRuntimeConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`${source} does not match the store config schema: ${issues}`);
  }
  return parsed.data;
}

export function readStoreConfigFile(file: string): StoreRuntimeConfig {
  return parseStoreConfigFile(fs.readFileSync(file, 'utf8'), file);
}

/** The config named by STORE_CONFIG_FILE, or null when the variable is unset. */
export function storeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StoreRuntimeConfig | null {
  const file = env[STORE_CONFIG_FILE_ENV];
  if (!file) return null;
  return readStoreConfigFile(file);
}
