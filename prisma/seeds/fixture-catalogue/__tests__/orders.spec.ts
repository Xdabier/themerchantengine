import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase B0 of the full-stack audit (specs/features/full-stack-audit-2026-05-14/plan.md
 * §3 #1 — close-first seed integrity). The COD test customer
 * (`cod-test+fixture@fixture.test`) must own at least one DELIVERED
 * order on the seeded product `fx-laptop-pro-16-studio` so the
 * happy-path reviews journey at `apps/storefront-e2e/src/reviews.journey.spec.ts:166`
 * passes the verified-purchase gate at
 * `apps/api/src/modules/reviews/reviews.service.ts:117-127` locally.
 *
 * Static spec: verifies the seed wiring, not the live DB state. The
 * integration proof lives in `apps/storefront-e2e/src/reviews.journey.spec.ts`
 * and `apps/api/test/reviews.e2e-spec.ts`, both of which exercise the
 * seeded DELIVERED order through the real review-create endpoint.
 */
const SEED_ROOT = path.resolve(__dirname, '..');

describe('fixture catalogue seed — DELIVERED order for COD customer', () => {
  it('orders.ts exists and exports seedOrders', () => {
    const file = path.join(SEED_ROOT, 'orders.ts');
    expect(fs.existsSync(file), 'orders.ts must exist').toBe(true);
    const src = fs.readFileSync(file, 'utf8');
    expect(src, 'orders.ts must export seedOrders').toMatch(
      /export\s+(async\s+)?function\s+seedOrders/,
    );
  });

  it('index.ts invokes seedOrders after seedCustomer', () => {
    const indexSrc = fs.readFileSync(path.join(SEED_ROOT, 'index.ts'), 'utf8');
    expect(indexSrc, 'index.ts must import seedOrders').toMatch(/import\s*\{\s*seedOrders[\s,}]/);
    const customerIdx = indexSrc.indexOf('await seedCustomer');
    const ordersIdx = indexSrc.indexOf('await seedOrders');
    expect(customerIdx, 'seedCustomer invocation expected').toBeGreaterThan(-1);
    expect(ordersIdx, 'seedOrders invocation expected').toBeGreaterThan(-1);
    expect(
      ordersIdx,
      'seedOrders must run AFTER seedCustomer (orders depend on customer.id)',
    ).toBeGreaterThan(customerIdx);
  });

  it('orders.ts targets the seed product slug + customer email + DELIVERED status', () => {
    const src = fs.readFileSync(path.join(SEED_ROOT, 'orders.ts'), 'utf8');
    expect(src, 'must reference SEED_PRODUCT_SLUG fx-laptop-pro-16-studio').toContain(
      'fx-laptop-pro-16-studio',
    );
    expect(src, 'must reference COD customer email').toContain('cod-test+fixture@fixture.test');
    expect(src, 'must mark the order DELIVERED').toMatch(
      /OrderStatus\.DELIVERED|['"]DELIVERED['"]/,
    );
  });

  it('orders.ts is idempotent — find-then-create, never update/upsert/delete', () => {
    const src = fs.readFileSync(path.join(SEED_ROOT, 'orders.ts'), 'utf8');
    expect(src, 'idempotent guard must check for existing order').toMatch(
      /findFirst|findUnique|count/,
    );
    // §3.4 + append-only-static.spec.ts — only `create` / `createMany` are
    // allowed on Order/OrderItem; never update / upsert / delete.
    expect(src).not.toMatch(/prisma\.order\.(update|updateMany|upsert|delete|deleteMany)/);
    expect(src).not.toMatch(/prisma\.orderItem\.(update|updateMany|upsert|delete|deleteMany)/);
  });

  it('idempotency.ts preserves the COD customer across re-seeds', () => {
    const src = fs.readFileSync(path.join(SEED_ROOT, 'lib', 'idempotency.ts'), 'utf8');
    // The COD customer owns the seeded Order. Hard-deleting the user would
    // set Order.userId to NULL (FK action `SetNull` per schema.prisma:827)
    // and orphan the seeded fixture — the next re-seed would create a
    // fresh customer id with no DELIVERED order linked, regressing the
    // verified-purchase gate. The customer email pattern must be filtered
    // out of the final user.deleteMany.
    expect(src, 'COD customer email must be cited as a cleanup exclusion').toContain('cod-test+');
  });
});
