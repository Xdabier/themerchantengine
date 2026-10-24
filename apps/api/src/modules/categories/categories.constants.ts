export const CATEGORIES_REDIS_CLIENT = 'CATEGORIES_REDIS_CLIENT';
export const CATEGORY_TREE_CACHE_KEY = 'categories:tree:v2';
export const CATEGORY_TREE_TTL_SECONDS = 3600; // 1 hour

/** Columns the storefront/admin may sort category products by */
export const VALID_PRODUCT_SORT_FIELDS = ['sortOrder', 'createdAt', 'publishedAt'] as const;

/** SEO redirect event — emitted when a category's slug changes */
export const CATEGORY_SLUG_CHANGED_EVENT = 'category.slug.changed';
