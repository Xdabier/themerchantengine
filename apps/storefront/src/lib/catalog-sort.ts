/**
 * The one place that decides what "sorted" means for the catalogue.
 *
 * Authority: `specs/features/storefront-qa-remediation/plan-k-storefront-data-hygiene.md`
 * Phase K4, decision K-D8 (finding C7, behaviour half).
 *
 * THE BUG THIS FIXES. The sort select seeds itself to "Newest" on first load,
 * but the four query builders (catalog page and category page, each with an SSR
 * loader and a browser builder) only forwarded `sortBy` / `sortOrder` when the
 * URL already carried them. On a bare `/fr/catalog` nothing was sent, so the API
 * fell back to `sortBy: 'sortOrder' asc` (`products.service.ts`). Every product
 * has `sortOrder = 0`, so the order was unspecified and Postgres physical order
 * decided it. The select said "Newest" over whatever happened to be on disk,
 * and page 2 of an unspecified order can repeat or skip rows.
 *
 * Fixed on the storefront rather than in the API fallback: the storefront is
 * where the claim is made, and changing the API default would silently reorder
 * every other caller, including the home rails.
 *
 * The resolver is total. Given any URL pair it returns a concrete sort, and it
 * agrees with the select by construction: both read `catalogSortKeyFromQuery`,
 * so the label and the request can no longer disagree.
 */

export type CatalogSortKey = 'newest' | 'priceAsc' | 'priceDesc' | 'nameAsc';

export interface CatalogSort {
  sortBy: 'createdAt' | 'price' | 'name';
  sortOrder: 'asc' | 'desc';
}

export const CATALOG_SORT_MAP: Record<CatalogSortKey, CatalogSort> = {
  newest: { sortBy: 'createdAt', sortOrder: 'desc' },
  priceAsc: { sortBy: 'price', sortOrder: 'asc' },
  priceDesc: { sortBy: 'price', sortOrder: 'desc' },
  nameAsc: { sortBy: 'name', sortOrder: 'asc' },
};

/** What the select shows when the URL names no sort it offers. */
export const DEFAULT_CATALOG_SORT_KEY: CatalogSortKey = 'newest';

/**
 * Maps a URL pair onto the key the select displays. Anything outside the three
 * explicit pairs reads as "Newest", which is what the control has always done.
 */
export function catalogSortKeyFromQuery(
  sortBy?: string | null,
  sortOrder?: string | null,
): CatalogSortKey {
  if (sortBy === 'price' && sortOrder === 'asc') return 'priceAsc';
  if (sortBy === 'price' && sortOrder === 'desc') return 'priceDesc';
  if (sortBy === 'name' && sortOrder === 'asc') return 'nameAsc';
  return DEFAULT_CATALOG_SORT_KEY;
}

/**
 * The concrete sort to send to `/v1/products` for a given URL pair. Always
 * returns a pair, so the request never falls through to the API default.
 */
export function resolveCatalogSort(sortBy?: string | null, sortOrder?: string | null): CatalogSort {
  return CATALOG_SORT_MAP[catalogSortKeyFromQuery(sortBy, sortOrder)];
}
