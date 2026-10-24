// ── Event types ───────────────────────────────────────────────────────────────

export const ANALYTICS_EVENT_TYPES = [
  // Every navigation, including the ones that never reach a product. Not a
  // funnel step: the funnel below measures intent to buy, and a page view is
  // the denominator, not a rung on it.
  'page_view',
  'product_view',
  'add_to_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
  'search',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

/** Ordered funnel steps (search excluded — it's a parallel signal). */
export const ANALYTICS_FUNNEL_STEPS: AnalyticsEventType[] = [
  'product_view',
  'add_to_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
];

// ── StoreSetting keys ─────────────────────────────────────────────────────────

export const ANALYTICS_PIXELS_GROUP = 'analytics';
export const ANALYTICS_PIXELS_KEY = 'pixels';

// ── Limits ────────────────────────────────────────────────────────────────────

/** Maximum search events fetched for top-query aggregation. */
export const ANALYTICS_SEARCH_FETCH_LIMIT = 2_000;

/** Number of top search queries returned. */
export const ANALYTICS_TOP_QUERIES_COUNT = 20;

/** Number of top products returned in product analytics. */
export const ANALYTICS_TOP_PRODUCTS_COUNT = 50;
