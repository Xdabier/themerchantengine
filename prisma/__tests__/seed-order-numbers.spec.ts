import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SEEDED_ORDER_COUNT, seedOrderNumber } from '../order-number';

/**
 * Finding AD13 - the seed and the generator must issue order numbers in one
 * format and one namespace.
 *
 * The seed used to write four-digit numbers, so seeded and generated orders
 * lived in different namespaces and nobody noticed the two formats. Padding the
 * seed to the generator's six digits puts them in the SAME namespace, which is
 * what makes the sequence reservation below load-bearing rather than tidy: the
 * first order placed on a freshly seeded database would otherwise be handed
 * ORD-YYYY-000001 a second time and die on the unique index.
 *
 * The remaining half is the year. The literals were pinned to `2026` while the
 * sequence the seed reserves is named for the CURRENT year, so a seed run in
 * any later year wrote rows stamped 2026 and reserved a sequence nothing had
 * used.
 */

/** The exact shape `OrdersService.generateOrderNumber` produces. */
const GENERATOR_FORMAT = /^ORD-\d{4}-\d{6}$/;

describe('seedOrderNumber', () => {
  it('matches the generator format exactly', () => {
    for (let n = 1; n <= SEEDED_ORDER_COUNT; n += 1) {
      expect(seedOrderNumber(n)).toMatch(GENERATOR_FORMAT);
    }
  });

  it('pads to the generator six digits, not four', () => {
    expect(seedOrderNumber(1, 2026)).toBe('ORD-2026-000001');
    expect(seedOrderNumber(4, 2026)).toBe('ORD-2026-000004');
  });

  it('stamps the year it is run in, not a pinned one', () => {
    expect(seedOrderNumber(1, 2031)).toBe('ORD-2031-000001');
    expect(seedOrderNumber(1)).toContain(String(new Date().getFullYear()));
  });

  it('reserves exactly as many numbers as the seed writes', () => {
    expect(SEEDED_ORDER_COUNT).toBe(4);
  });
});

describe('seed.ts order numbers', () => {
  const seedSource = readFileSync(join(__dirname, '..', 'seed.ts'), 'utf8');

  /**
   * Read over the source, because the defect was a literal. A test that only
   * exercised the helper would stay green while `seed.ts` kept its hardcoded
   * strings, which is exactly the guard that cannot fail.
   */
  it('builds every seeded order number through the helper', () => {
    const hardcoded = seedSource
      .split(/\r?\n/)
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /orderNumber:\s*'ORD-/.test(line))
      .map(({ line, n }) => `seed.ts:${n}: ${line.trim()}`);
    expect(hardcoded).toEqual([]);
  });

  it('reserves the sequence for the same year it stamps on the rows', () => {
    // Both sides read `currentYear`; a literal on either half puts the rows and
    // the reservation in different years.
    expect(seedSource).toContain('order_seq_${currentYear}');
    expect(seedSource).not.toMatch(/order_seq_20\d\d/);
  });
});
