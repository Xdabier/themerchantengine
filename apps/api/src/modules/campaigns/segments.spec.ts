import { buildSegmentUserWhere } from './segments';

const NOW = new Date('2026-06-19T00:00:00.000Z');

describe('buildSegmentUserWhere', () => {
  it('returns null for ALL_CONFIRMED (no order-history filter)', () => {
    expect(buildSegmentUserWhere('ALL_CONFIRMED', NOW)).toBeNull();
  });

  it('scopes every segment to active customers', () => {
    for (const seg of ['NEW', 'ACTIVE', 'LOYAL', 'AT_RISK', 'CHURNED', 'LAPSED'] as const) {
      const where = buildSegmentUserWhere(seg, NOW)!;
      expect(where.role).toBe('CUSTOMER');
      expect(where.isActive).toBe(true);
    }
  });

  it('AT_RISK = ordered in the last year but not the last 180 days', () => {
    const where = buildSegmentUserWhere('AT_RISK', NOW)! as Record<string, never>;
    const orders = (where as { orders: { some: unknown; none: unknown } }).orders;
    expect(orders.some).toBeDefined();
    expect(orders.none).toBeDefined();
  });

  it('CHURNED = ordered at some point but not in the last year', () => {
    const where = buildSegmentUserWhere('CHURNED', NOW)! as {
      orders: { some: object; none: object };
    };
    expect(where.orders.some).toEqual({});
    expect(where.orders.none).toHaveProperty('createdAt');
  });

  it('LAPSED = ordered ever but not in the last 180 days (AT_RISK ∪ CHURNED)', () => {
    const where = buildSegmentUserWhere('LAPSED', NOW)! as {
      orders: { some: object; none: object };
    };
    expect(where.orders.some).toEqual({});
    expect(where.orders.none).toHaveProperty('createdAt');
  });
});
