import { OrderStatus, Prisma } from '@prisma/client';
import { CustomerSegment } from './dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant `days` before `now` — the boundary every cohort window uses. */
export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * WHERE predicate for one customer cohort. A single definition serves both the
 * segment counts and the customers-list `segment` filter, so a chip's count and
 * the rows behind it can never drift apart.
 *
 * HIGH_VALUE and VIP have no criteria anywhere in the product, so they match
 * nobody. Matching everybody would resurrect the silently-ignored filter this
 * helper exists to kill.
 */
export function segmentWhere(segment: CustomerSegment, now: Date): Prisma.UserWhereInput {
  switch (segment) {
    case CustomerSegment.NEW:
      return { createdAt: { gte: daysBefore(now, 30) }, orders: { none: {} } };
    case CustomerSegment.ACTIVE:
      return { orders: { some: { createdAt: { gte: daysBefore(now, 90) } } } };
    case CustomerSegment.LOYAL:
      return {
        createdAt: { lt: daysBefore(now, 30) },
        orders: { some: { status: OrderStatus.DELIVERED } },
      };
    case CustomerSegment.AT_RISK:
      return {
        orders: {
          some: { createdAt: { gte: daysBefore(now, 365) } },
          none: { createdAt: { gte: daysBefore(now, 180) } },
        },
      };
    case CustomerSegment.CHURNED:
      return { orders: { some: {}, none: { createdAt: { gte: daysBefore(now, 365) } } } };
    default:
      return { id: { in: [] } };
  }
}

/**
 * Per-row inputs for {@link deriveSegment}. All three order-derived values are
 * payment-UNFILTERED because the cohort predicates above ignore payment status;
 * a customer whose only recent orders are still PENDING is ACTIVE all the same.
 */
export type SegmentInputs = {
  createdAt: Date;
  orderCount: number;
  lastOrderAt: Date | null;
  deliveredOrders: number;
};

/**
 * The badge a customer row carries. Mirrors the count predicates exactly, then
 * collapses their deliberate overlap with a documented precedence:
 * LOYAL > ACTIVE > AT_RISK > CHURNED > NEW > none. The filter matches the raw
 * predicate rather than this precedence, so a row filtered by ACTIVE may show a
 * LOYAL badge — correct, it is both.
 */
export function deriveSegment(input: SegmentInputs, now: Date): CustomerSegment | null {
  const { createdAt, orderCount, lastOrderAt, deliveredOrders } = input;

  if (deliveredOrders > 0 && createdAt < daysBefore(now, 30)) return CustomerSegment.LOYAL;
  if (lastOrderAt && lastOrderAt >= daysBefore(now, 90)) return CustomerSegment.ACTIVE;
  if (lastOrderAt && lastOrderAt >= daysBefore(now, 365) && lastOrderAt < daysBefore(now, 180)) {
    return CustomerSegment.AT_RISK;
  }
  if (orderCount > 0 && (!lastOrderAt || lastOrderAt < daysBefore(now, 365))) {
    return CustomerSegment.CHURNED;
  }
  if (orderCount === 0 && createdAt >= daysBefore(now, 30)) return CustomerSegment.NEW;
  return null;
}
