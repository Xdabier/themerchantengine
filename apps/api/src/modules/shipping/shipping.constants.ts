export const VALID_ZONE_SORT_FIELDS = ['priority', 'createdAt', 'updatedAt'] as const;
export const VALID_METHOD_SORT_FIELDS = ['sortOrder', 'createdAt', 'updatedAt'] as const;

// ── Redis ─────────────────────────────────────────────────────────────────────

export const SHIPPING_REDIS_CLIENT = 'SHIPPING_REDIS_CLIENT';

/** Zone data cache key prefix (keyed by country code): shipping:zones:<country> */
export const SHIPPING_ZONES_CACHE_PREFIX = 'shipping:zones:';

/** 15-minute TTL for shipping zone/rate data (spec §08) */
export const SHIPPING_ZONES_TTL_SECONDS = 15 * 60;
