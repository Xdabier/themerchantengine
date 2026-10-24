import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static guard: the seed graph must never mutate or delete an append-only
 * row. Constitution §3.4 forbids `update` / `updateMany` / `upsert` /
 * `delete` / `deleteMany` on these tables; `create` / `createMany` are
 * permitted (and required for the seeded DELIVERED order — see
 * `orders.ts` + `__tests__/orders.spec.ts`).
 *
 * Scan covers every file under `prisma/seeds/fixture-catalogue/` including
 * `lib/idempotency.ts` (which contains the cleanup deleteMany calls — those
 * scope to non-append-only models only and the static guard verifies that).
 */
describe('fixture catalogue seed — static append-only audit', () => {
  const seedRoot = path.resolve(__dirname, '..');
  const sourceFiles = walk(seedRoot).filter((f) => f.endsWith('.ts') && !f.includes('__tests__'));

  // Mutate / destroy verbs are forbidden on every append-only table.
  const MUTATING_VERBS = ['upsert', 'update', 'updateMany', 'delete', 'deleteMany'] as const;
  // `create` / `createMany` are forbidden on the strict subset — these
  // models are never written by the seed (no fixture story exists for
  // returns, inventory movements, gift-card txs, promotion usages,
  // audit-log entries, or invoices).
  const ALL_FORBIDDEN_VERBS = [...MUTATING_VERBS, 'create', 'createMany'] as const;

  const APPEND_ONLY_PATTERNS: { model: string; tokens: string[] }[] = [
    { model: 'Order', tokens: MUTATING_VERBS.map((v) => `prisma.order.${v}`) },
    { model: 'OrderItem', tokens: MUTATING_VERBS.map((v) => `prisma.orderItem.${v}`) },
    {
      model: 'InventoryMovement',
      tokens: ALL_FORBIDDEN_VERBS.map((v) => `prisma.inventoryMovement.${v}`),
    },
    {
      model: 'GiftCardTransaction',
      tokens: ALL_FORBIDDEN_VERBS.map((v) => `prisma.giftCardTransaction.${v}`),
    },
    {
      model: 'PromotionUsage',
      tokens: ALL_FORBIDDEN_VERBS.map((v) => `prisma.promotionUsage.${v}`),
    },
    {
      model: 'AuditLogEntry',
      tokens: ALL_FORBIDDEN_VERBS.map((v) => `prisma.auditLogEntry.${v}`),
    },
    { model: 'Return', tokens: ALL_FORBIDDEN_VERBS.map((v) => `prisma.return.${v}`) },
    {
      model: 'ReturnItem',
      tokens: ALL_FORBIDDEN_VERBS.map((v) => `prisma.returnItem.${v}`),
    },
    { model: 'Invoice', tokens: ALL_FORBIDDEN_VERBS.map((v) => `prisma.invoice.${v}`) },
  ];

  for (const { model, tokens } of APPEND_ONLY_PATTERNS) {
    it(`never writes ${model}`, () => {
      const offenders: string[] = [];
      for (const file of sourceFiles) {
        const src = fs.readFileSync(file, 'utf8');
        for (const token of tokens) {
          if (src.includes(token)) {
            offenders.push(`${path.relative(seedRoot, file)}: ${token}`);
          }
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([]);
    });
  }
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
