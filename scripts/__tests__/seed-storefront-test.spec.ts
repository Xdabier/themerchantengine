/**
 * The storefront e2e seed runs on the host and, in CI, inside the Playwright
 * image, which has no docker CLI. Applying the FTS setup through
 * `docker exec` into the test Postgres container failed there with
 * "docker: not found". The seed applies it over the test DB URL instead, with
 * the same applier `npm run db:fts` uses.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SEED = path.resolve(__dirname, '..', 'seed-storefront-test.ts');

describe('seed-storefront-test FTS step', () => {
  const source = fs.readFileSync(SEED, 'utf8');

  it('never shells out to docker', () => {
    expect(source).not.toMatch(/docker\s+exec/);
  });

  it('applies the FTS setup over the test DB URL', () => {
    expect(source).toMatch(/from '\.\.\/prisma\/apply-fts-setup'/);
    expect(source).toMatch(/applyFtsSetup\(TEST_DB_URL\)/);
  });
});
