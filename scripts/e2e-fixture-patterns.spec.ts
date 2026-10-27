import {
  E2E_FIXTURE_PATTERNS,
  PRODUCT_KEEP_SLUGS,
  assertLocalDevOrTestDatabase,
  assertTestDatabase,
} from './e2e-fixture-patterns';

/**
 * Plan H, phase H1. These are the only things standing between a row-deleting
 * script and a database it must never reach, so they are tested rather than
 * reviewed.
 *
 * The invariants below are not stylistic. Each one encodes damage that was
 * either done or narrowly avoided, and each is written so that removing the
 * protection turns this file red.
 */
describe('e2e fixture cleanup safety', () => {
  const DEV = 'postgresql://postgres:postgres@localhost:55432/merchants_engine_dev';
  const TEST = 'postgresql://postgres:postgres@127.0.0.1:55433/merchants_engine_test';

  describe('assertLocalDevOrTestDatabase', () => {
    it('accepts the local dev and test databases and returns the name', () => {
      expect(assertLocalDevOrTestDatabase(DEV, 'spec')).toBe('merchants_engine_dev');
      expect(assertLocalDevOrTestDatabase(TEST, 'spec')).toBe('merchants_engine_test');
    });

    it('refuses a remote host even when the database name looks local', () => {
      expect(() =>
        assertLocalDevOrTestDatabase(
          'postgresql://postgres:x@store-pg-prod:5432/merchants_engine_dev',
          'spec',
        ),
      ).toThrow(/refusing to run against host "store-pg-prod"/);
    });

    it('refuses a production database name on localhost, which is how a tunnel looks', () => {
      expect(() =>
        assertLocalDevOrTestDatabase(
          'postgresql://postgres:x@localhost:5432/merchants_engine',
          'spec',
        ),
      ).toThrow(/refusing to run against database "merchants_engine"/);
    });

    it('refuses an unset or unparseable DATABASE_URL rather than guessing', () => {
      expect(() => assertLocalDevOrTestDatabase(undefined, 'spec')).toThrow(/is not set/);
      expect(() => assertLocalDevOrTestDatabase('merchants_engine_dev', 'spec')).toThrow(
        /not a URL/,
      );
    });
  });

  describe('assertTestDatabase', () => {
    it('accepts the test database', () => {
      expect(assertTestDatabase(TEST, 'spec')).toBe('merchants_engine_test');
    });

    it('refuses the DEV database, which the wider guard allows', () => {
      // The teardown sweep runs unattended after every suite. Reusing the
      // looser guard there would have let a mis-pointed harness sweep dev.
      expect(() => assertTestDatabase(DEV, 'spec')).toThrow(/not a _test database/);
    });
  });

  describe('pattern invariants', () => {
    const byTable = (table: string) => E2E_FIXTURE_PATTERNS.find((p) => p.table === table);

    it('never deletes a User, because Order.userId is onDelete SetNull', () => {
      // Deleting a matched customer orphans every order they placed, and the
      // seed converges on orderNumber alone so it never repairs them. There is
      // no undo for that; deactivation is reversible.
      const user = byTable('User');
      expect(user?.action).toBe('deactivate');
      expect(
        E2E_FIXTURE_PATTERNS.filter((p) => p.table === 'User' && p.action !== 'deactivate'),
      ).toHaveLength(0);
    });

    it('soft-deletes Product rather than removing it, because OrderItem references it', () => {
      expect(byTable('Product')?.action).toBe('soft');
    });

    it('excludes the storefront rich-text repro from the Product predicate', () => {
      // Storefront plan K phase K1 patched this keep-list in before plan H ran.
      // Plan D consumes the row; plan K phase K5 removes the exclusion.
      const product = byTable('Product');
      for (const slug of PRODUCT_KEEP_SLUGS) {
        expect(product?.where).toContain(slug);
      }
      expect(product?.where).toMatch(/NOT IN \(/);
    });

    it('matches shipping methods before the zones they hang off', () => {
      // The method predicate reaches methods through their zone. Soft-delete
      // the zone first and that half stops matching, stranding the methods.
      const method = E2E_FIXTURE_PATTERNS.findIndex((p) => p.table === 'ShippingMethod');
      const zone = E2E_FIXTURE_PATTERNS.findIndex((p) => p.table === 'ShippingZone');
      expect(method).toBeGreaterThanOrEqual(0);
      expect(method).toBeLessThan(zone);
    });

    it('only hard-deletes tables that have no deletedAt column', () => {
      const hard = E2E_FIXTURE_PATTERNS.filter((p) => p.action === 'hard').map((p) => p.table);
      expect(hard.sort()).toEqual(['Role', 'WebhookSubscription']);
    });

    it('will not delete an e2e Role that a user still holds', () => {
      // User.roleId is onDelete SetNull, so the database would let the delete
      // through and silently clear the account. The predicate is the guard.
      expect(byTable('Role')?.where).toMatch(/NOT EXISTS[\s\S]*"roleId"/);
    });

    it('touches no GiftCard and no Order at all', () => {
      const tables = E2E_FIXTURE_PATTERNS.map((p) => p.table);
      expect(tables).not.toContain('GiftCard');
      expect(tables).not.toContain('Order');
      expect(tables).not.toContain('OrderItem');
    });

    it('gives every pattern a note, since the report is what the operator reviews', () => {
      for (const pattern of E2E_FIXTURE_PATTERNS) {
        expect(pattern.note.length).toBeGreaterThan(20);
      }
    });
  });
});
