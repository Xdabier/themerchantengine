// ── Redis ─────────────────────────────────────────────────────────────────────

export const TAX_REDIS_CLIENT = 'TAX_REDIS_CLIENT';

/** Tax zone cache key prefix (keyed by country code): tax:zone:<country> */
export const TAX_ZONE_CACHE_PREFIX = 'tax:zone:';

/** Fallback zone cache key (isDefault = true) */
export const TAX_ZONE_DEFAULT_CACHE_KEY = 'tax:zone:__default__';

/** 1-hour TTL for tax zone data (spec §08) */
export const TAX_ZONE_TTL_SECONDS = 60 * 60;
