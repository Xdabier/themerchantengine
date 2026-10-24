// ── Pagination ────────────────────────────────────────────────────────────────

export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 20;
export const AUDIT_LOG_MAX_PAGE_SIZE = 100;

// ── Sort ──────────────────────────────────────────────────────────────────────

export const AUDIT_LOG_SORT_FIELDS = ['createdAt', 'action', 'entityType', 'userId'] as const;
export type AuditLogSortField = (typeof AUDIT_LOG_SORT_FIELDS)[number];

// ── Route → entity mapping ────────────────────────────────────────────────────

/**
 * Maps URL path segment (plural resource name) to singular entityType label
 * stored in AuditLogEntry.entityType.
 */
export const ENTITY_TYPE_MAP: Record<string, string> = {
  products: 'product',
  orders: 'order',
  users: 'user',
  categories: 'category',
  promotions: 'promotion',
  'gift-cards': 'gift_card',
  returns: 'return',
  reviews: 'review',
  inventory: 'inventory',
  shipping: 'shipping',
  tax: 'tax',
  assets: 'asset',
  notifications: 'notification',
  'storefront-config': 'storefront_config',
  webhooks: 'webhook',
  settings: 'setting',
  cms: 'cms',
  seo: 'seo',
  analytics: 'analytics',
  payments: 'payment',
  geo: 'geo',
  cart: 'cart',
  search: 'search',
};

/**
 * Maps URL path segment to Prisma client accessor name.
 * Used by the interceptor for "before" reads on PATCH/DELETE.
 * null means skip the DB fetch.
 */
export const ENTITY_MODEL_MAP: Record<string, string | null> = {
  products: 'product',
  orders: 'order',
  users: 'user',
  categories: 'category',
  promotions: 'promotion',
  'gift-cards': 'giftCard',
  returns: 'return',
  reviews: 'review',
  inventory: 'inventoryItem',
  shipping: 'shippingZone',
  tax: 'taxRate',
  assets: 'asset',
  notifications: 'notification',
  'storefront-config': 'storefrontConfig',
  webhooks: 'webhookSubscription',
  settings: 'setting',
  cms: 'cmsPage',
  seo: 'seoConfig',
  payments: 'payment',
  'audit-log': null, // never fetch before-state for audit log itself
};

/** HTTP methods that trigger an audit log entry. */
export const AUDIT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Method → action verb appended to entityType (e.g., "product.update"). */
export const METHOD_ACTION_MAP: Record<string, string> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};
