export const STOREFRONT_CONFIG_REDIS_CLIENT = 'STOREFRONT_CONFIG_REDIS_CLIENT';

/** Cache key prefix — append pageSlug to get per-page key. */
export const STOREFRONT_SECTIONS_CACHE_PREFIX = 'storefront:sections:';

/** Cache TTL — 10 minutes. */
export const STOREFRONT_SECTIONS_TTL_SECONDS = 600;

export const SECTION_DEFAULT_PAGE_SIZE = 20;
export const SECTION_MAX_PAGE_SIZE = 100;

/**
 * Cache key for the public storefront config. One key, no per-page suffix: the
 * payload is store-wide and the Translatable fields on it are resolved per
 * request by the global interceptor, downstream of the cache.
 */
export const STOREFRONT_PUBLIC_CONFIG_CACHE_KEY = 'storefront:config';

/**
 * Cache TTL for the public config, in seconds.
 *
 * Deliberately not the sections window. The settings behind this payload live
 * in four different modules (settings, currencies, analytics, and later
 * appearance), so invalidating on mutation would need this module to reach
 * into all four, against the one-way dependency direction §3.1 sets. A short
 * TTL buys the same freshness with no coupling: an operator who renames the
 * store or configures a pixel sees it on the storefront inside a minute.
 */
export const STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS = 60;

/**
 * Cache key of the composed runtime config behind `GET /v1/store/config`
 * (plan E1.2). Same window as the public config; both keys are dropped on
 * `store-config.updated`, so the TTL only covers a write that bypassed the
 * services (a raw seed).
 */
export const STORE_CONFIG_CACHE_KEY = 'store:config';

/**
 * Fallback low-stock threshold, mirroring `LOW_STOCK_THRESHOLD` in
 * `inventory.constants.ts`. Duplicated rather than imported because this
 * module must not depend on inventory (§3.1); the two are held together by
 * `storefront-config.service.spec.ts`, which asserts the fallback value.
 */
export const STOREFRONT_LOW_STOCK_FALLBACK = 10;
