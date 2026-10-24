/**
 * Audience segment → User where-clause (NE9).
 *
 * The order-history definitions mirror `users/processors/customer-segmentation
 * .processor.ts` (the canonical segment math) so a campaign segment and the
 * daily segment snapshot agree. Reads are via the campaigns module's injected
 * Prisma — a shared-DB read, not a cross-module service reach (§3.1).
 */
import type { Prisma } from '@prisma/client';
import type { CampaignSegment } from './campaigns.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build the User filter for a segment, anchored at `now`. Returns `null` for
 * ALL_CONFIRMED (no order-history filter — every confirmed subscriber). Always
 * scopes to active customers.
 */
export function buildSegmentUserWhere(
  segment: CampaignSegment,
  now: Date,
): Prisma.UserWhereInput | null {
  if (segment === 'ALL_CONFIRMED') return null;

  const days = (n: number) => new Date(now.getTime() - n * DAY_MS);
  const base: Prisma.UserWhereInput = { role: 'CUSTOMER', isActive: true };

  switch (segment) {
    case 'NEW':
      return { ...base, createdAt: { gte: days(30) }, orders: { none: {} } };
    case 'ACTIVE':
      return { ...base, orders: { some: { createdAt: { gte: days(90) } } } };
    case 'LOYAL':
      return { ...base, createdAt: { lt: days(30) }, orders: { some: { status: 'DELIVERED' } } };
    case 'AT_RISK':
      return {
        ...base,
        orders: {
          some: { createdAt: { gte: days(365) } },
          none: { createdAt: { gte: days(180) } },
        },
      };
    case 'CHURNED':
      return { ...base, orders: { some: {}, none: { createdAt: { gte: days(365) } } } };
    case 'LAPSED':
      // AT_RISK ∪ CHURNED — ordered at some point, but not in the last 180 days.
      return { ...base, orders: { some: {}, none: { createdAt: { gte: days(180) } } } };
    default:
      return null;
  }
}
