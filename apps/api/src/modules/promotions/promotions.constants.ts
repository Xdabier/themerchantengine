/** Allowlisted sort fields for admin promotion queries. */
export const PROMOTION_SORT_FIELDS = ['createdAt', 'priority', 'startsAt', 'endsAt'] as const;

export type PromotionSortField = (typeof PROMOTION_SORT_FIELDS)[number];
