import * as fs from 'fs';
import * as path from 'path';
import { storeConfigFixtureSchema, type StoreConfigFixture } from './store-config-fixture.schema';

export const STORE_CONFIG_FIXTURE_IDS = ['demo', 'gulf-rtl', 'maghreb-ltr', 'trilingual'] as const;
export type StoreConfigFixtureId = (typeof STORE_CONFIG_FIXTURE_IDS)[number];

export const STORE_CONFIG_FIXTURE_ENV = 'STORE_CONFIG_FIXTURE';
export const DEFAULT_STORE_CONFIG_FIXTURE: StoreConfigFixtureId = 'demo';

export function isStoreConfigFixtureId(value: string): value is StoreConfigFixtureId {
  return (STORE_CONFIG_FIXTURE_IDS as readonly string[]).includes(value);
}

/** Walks up from this file until it finds the workspace root (the directory holding nx.json). */
export function workspaceRoot(start: string = __dirname): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`workspace root (nx.json) not found above ${start}`);
}

export function storeConfigFixturesDir(root: string = workspaceRoot()): string {
  return path.join(root, 'test', 'fixtures', 'store-configs');
}

export function storeConfigFixturePath(id: StoreConfigFixtureId, root?: string): string {
  return path.join(storeConfigFixturesDir(root), `${id}.config.json`);
}

const cache = new Map<string, StoreConfigFixture>();

/** Reads and validates one fixture. Throws with the Zod issues when the file drifts from the schema. */
export function loadStoreConfigFixture(
  id: StoreConfigFixtureId,
  root?: string,
): StoreConfigFixture {
  const file = storeConfigFixturePath(id, root);
  const cached = cache.get(file);
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  const parsed = storeConfigFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`${file} does not match the store config fixture schema: ${issues}`);
  }
  if (parsed.data.fixture.id !== id) {
    throw new Error(`${file}: fixture.id is ${parsed.data.fixture.id}, expected ${id}`);
  }
  cache.set(file, parsed.data);
  return parsed.data;
}

/** The fixture id the current process runs under: STORE_CONFIG_FIXTURE, default demo. */
export function activeStoreConfigFixtureId(
  env: NodeJS.ProcessEnv = process.env,
): StoreConfigFixtureId {
  const value = env[STORE_CONFIG_FIXTURE_ENV];
  if (value === undefined || value === '') return DEFAULT_STORE_CONFIG_FIXTURE;
  if (!isStoreConfigFixtureId(value)) {
    throw new Error(
      `${STORE_CONFIG_FIXTURE_ENV}=${value} is not a fixture id; expected one of ${STORE_CONFIG_FIXTURE_IDS.join(', ')}`,
    );
  }
  return value;
}

/**
 * Harness view of the same variable: `null` means STORE_CONFIG_FIXTURE is unset
 * and the seed's own defaults are active. The three e2e harnesses log this at
 * seed time and derive locale and money assertions from the returned fixture.
 */
export function harnessStoreConfigFixtureId(
  env: NodeJS.ProcessEnv = process.env,
): StoreConfigFixtureId | null {
  const value = env[STORE_CONFIG_FIXTURE_ENV];
  if (value === undefined || value === '') return null;
  return activeStoreConfigFixtureId(env);
}

export function harnessStoreConfigFixture(
  env: NodeJS.ProcessEnv = process.env,
  root?: string,
): StoreConfigFixture | null {
  const id = harnessStoreConfigFixtureId(env);
  return id ? loadStoreConfigFixture(id, root) : null;
}

export function describeHarnessStoreConfig(env: NodeJS.ProcessEnv = process.env): string {
  const id = harnessStoreConfigFixtureId(env);
  return id
    ? `store config fixture ${id}`
    : `store config: seed defaults (${STORE_CONFIG_FIXTURE_ENV} unset)`;
}

export function activeStoreConfigFixture(
  env?: NodeJS.ProcessEnv,
  root?: string,
): StoreConfigFixture {
  return loadStoreConfigFixture(activeStoreConfigFixtureId(env), root);
}
