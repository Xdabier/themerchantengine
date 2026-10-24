import { E2E_FIXTURE_PATTERNS } from './e2e-fixture-patterns';
import { pendingPredicate, sweepTestFixtures } from './e2e-fixture-sweep';

/**
 * Plan H, phase H2. This sweep runs unattended after every admin e2e run, with
 * no operator reading a dry run first, so its two properties have to hold by
 * construction: it writes only to a `_test` database, and it never turns a
 * green suite red.
 *
 * Neither test needs a live database. The guard returns before a client is
 * ever constructed, which is the point: a refusal must not depend on a
 * connection succeeding.
 */
describe('sweepTestFixtures', () => {
  const DEV = 'postgresql://postgres:postgres@localhost:55432/merchants_engine_dev';
  const PROD = 'postgresql://postgres:x@store-pg-prod:5432/merchants_engine';

  it('refuses the dev database and says so, without throwing', async () => {
    const lines: string[] = [];
    await expect(sweepTestFixtures(DEV, (m) => lines.push(m))).resolves.toBe(0);
    expect(lines.join('\n')).toMatch(/sweep skipped[\s\S]*not a _test database/);
  });

  it('refuses a production URL', async () => {
    const lines: string[] = [];
    await expect(sweepTestFixtures(PROD, (m) => lines.push(m))).resolves.toBe(0);
    expect(lines.join('\n')).toMatch(/sweep skipped/);
  });

  it('refuses an unset DATABASE_URL rather than falling back to anything', async () => {
    const lines: string[] = [];
    await expect(sweepTestFixtures(undefined, (m) => lines.push(m))).resolves.toBe(0);
    expect(lines.join('\n')).toMatch(/sweep skipped/);
  });

  describe('pendingPredicate', () => {
    const find = (table: string) => E2E_FIXTURE_PATTERNS.find((p) => p.table === table)!;

    it('skips rows a previous run already soft-deleted', () => {
      // Without this the second run re-stamps the same rows, every run reports
      // work, and the "re-run to zero" idempotency proof can never be obtained.
      expect(pendingPredicate(find('ShippingZone'))).toMatch(/^"deletedAt" IS NULL AND \(/);
    });

    it('skips users a previous run already deactivated', () => {
      expect(pendingPredicate(find('User'))).toMatch(/^"isActive" = true AND \(/);
    });

    it('adds no state clause to a hard delete, which has no column to check', () => {
      const role = find('Role');
      expect(pendingPredicate(role)).toBe(role.where);
    });
  });
});
