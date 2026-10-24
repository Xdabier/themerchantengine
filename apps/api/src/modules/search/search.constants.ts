export const VALID_SEARCH_SORT_FIELDS = [
  'relevance',
  'price',
  'rating',
  'createdAt',
  'name',
] as const;

export type SearchSortField = (typeof VALID_SEARCH_SORT_FIELDS)[number];

export const VALID_ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsPeriod = (typeof VALID_ANALYTICS_PERIODS)[number];

export const MERCHANDISING_RULE_TYPES = ['BOOST', 'BURY', 'PIN', 'REDIRECT'] as const;
export type MerchandisingRuleType = (typeof MERCHANDISING_RULE_TYPES)[number];

export const MAX_SUGGESTIONS = 8;
export const SEARCH_DEFAULT_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGE_SIZE = 100;
// Max candidate IDs fetched from FTS before pagination; caps memory usage.
export const FTS_CANDIDATE_LIMIT = 500;
// Trigram similarity threshold for fuzzy matching.
export const TRGM_THRESHOLD = 0.15;

export const SEARCH_EVENTS = {
  SEARCH_PERFORMED: 'search.performed',
  PRODUCT_CLICKED: 'search.product_clicked',
  ORDER_CONVERTED: 'search.order_converted',
} as const;
