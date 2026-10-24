// The dto barrel pulls class-validator decorators; this spec imports nothing
// from Nest that would load the polyfill for us.
import 'reflect-metadata';
import { CustomerSegment } from './dto';
import { daysBefore, deriveSegment, segmentWhere } from './users.segments';

const NOW = new Date('2026-08-15T12:00:00Z');

function inputs(overrides: Partial<Parameters<typeof deriveSegment>[0]> = {}) {
  return {
    createdAt: daysBefore(NOW, 400),
    orderCount: 0,
    lastOrderAt: null,
    deliveredOrders: 0,
    ...overrides,
  };
}

describe('users.segments', () => {
  describe('segmentWhere', () => {
    it('scopes NEW to fresh accounts with no orders', () => {
      expect(segmentWhere(CustomerSegment.NEW, NOW)).toEqual({
        createdAt: { gte: daysBefore(NOW, 30) },
        orders: { none: {} },
      });
    });

    it('scopes AT_RISK to the 365-to-180-day window', () => {
      expect(segmentWhere(CustomerSegment.AT_RISK, NOW)).toEqual({
        orders: {
          some: { createdAt: { gte: daysBefore(NOW, 365) } },
          none: { createdAt: { gte: daysBefore(NOW, 180) } },
        },
      });
    });

    it('matches nobody for the criteria-less cohorts', () => {
      expect(segmentWhere(CustomerSegment.VIP, NOW)).toEqual({ id: { in: [] } });
      expect(segmentWhere(CustomerSegment.HIGH_VALUE, NOW)).toEqual({ id: { in: [] } });
    });
  });

  describe('deriveSegment', () => {
    it('returns null for an established account that never ordered', () => {
      expect(deriveSegment(inputs(), NOW)).toBeNull();
    });

    it('returns NEW for a fresh account that never ordered', () => {
      expect(deriveSegment(inputs({ createdAt: daysBefore(NOW, 5) }), NOW)).toBe(
        CustomerSegment.NEW,
      );
    });

    it('returns ACTIVE on recency alone, whatever the payment status was', () => {
      expect(deriveSegment(inputs({ orderCount: 1, lastOrderAt: daysBefore(NOW, 10) }), NOW)).toBe(
        CustomerSegment.ACTIVE,
      );
    });

    it('returns AT_RISK between 180 and 365 days', () => {
      expect(deriveSegment(inputs({ orderCount: 1, lastOrderAt: daysBefore(NOW, 200) }), NOW)).toBe(
        CustomerSegment.AT_RISK,
      );
    });

    it('returns CHURNED past 365 days', () => {
      expect(deriveSegment(inputs({ orderCount: 1, lastOrderAt: daysBefore(NOW, 400) }), NOW)).toBe(
        CustomerSegment.CHURNED,
      );
    });

    it('prefers LOYAL over every other match', () => {
      expect(
        deriveSegment(
          inputs({ orderCount: 3, lastOrderAt: daysBefore(NOW, 1), deliveredOrders: 1 }),
          NOW,
        ),
      ).toBe(CustomerSegment.LOYAL);
    });

    it('withholds LOYAL from accounts younger than 30 days', () => {
      expect(
        deriveSegment(
          inputs({
            createdAt: daysBefore(NOW, 5),
            orderCount: 1,
            lastOrderAt: daysBefore(NOW, 1),
            deliveredOrders: 1,
          }),
          NOW,
        ),
      ).toBe(CustomerSegment.ACTIVE);
    });
  });
});
