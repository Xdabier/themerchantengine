import { describe, expect, it } from 'vitest';

import {
  CATALOG_SORT_MAP,
  DEFAULT_CATALOG_SORT_KEY,
  catalogSortKeyFromQuery,
  resolveCatalogSort,
} from './catalog-sort';

describe('catalog sort resolution (plan K Phase K4, finding C7)', () => {
  describe('catalogSortKeyFromQuery', () => {
    it('recognises each pair the select offers', () => {
      expect(catalogSortKeyFromQuery('price', 'asc')).toBe('priceAsc');
      expect(catalogSortKeyFromQuery('price', 'desc')).toBe('priceDesc');
      expect(catalogSortKeyFromQuery('name', 'asc')).toBe('nameAsc');
      expect(catalogSortKeyFromQuery('createdAt', 'desc')).toBe('newest');
    });

    it('reads anything else as the default', () => {
      // A bare URL, a half pair, and a nonsense pair all show "Newest" in the
      // select, so they must all resolve to it here too.
      expect(catalogSortKeyFromQuery(null, null)).toBe(DEFAULT_CATALOG_SORT_KEY);
      expect(catalogSortKeyFromQuery(undefined, undefined)).toBe(DEFAULT_CATALOG_SORT_KEY);
      expect(catalogSortKeyFromQuery('price', null)).toBe(DEFAULT_CATALOG_SORT_KEY);
      expect(catalogSortKeyFromQuery('name', 'desc')).toBe(DEFAULT_CATALOG_SORT_KEY);
      expect(catalogSortKeyFromQuery('bogus', 'sideways')).toBe(DEFAULT_CATALOG_SORT_KEY);
    });
  });

  describe('resolveCatalogSort', () => {
    it('always returns a concrete pair, so the API default is never reached', () => {
      // The API falls back to `sortOrder asc`, and every product has
      // sortOrder 0, which is the unspecified order finding C7 reported.
      for (const input of [
        [null, null],
        [undefined, undefined],
        ['bogus', 'sideways'],
        ['price', null],
      ] as const) {
        const sort = resolveCatalogSort(input[0], input[1]);
        expect(sort.sortBy).toBeTruthy();
        expect(['asc', 'desc']).toContain(sort.sortOrder);
      }
    });

    it('defaults to newest first', () => {
      expect(resolveCatalogSort()).toEqual({ sortBy: 'createdAt', sortOrder: 'desc' });
    });

    it('keeps an explicit pair', () => {
      expect(resolveCatalogSort('price', 'asc')).toEqual({ sortBy: 'price', sortOrder: 'asc' });
      expect(resolveCatalogSort('name', 'asc')).toEqual({ sortBy: 'name', sortOrder: 'asc' });
    });

    it('agrees with the key the select displays, for every key', () => {
      // This is the invariant that stops the label and the request drifting
      // apart again: one map, read by both.
      for (const key of Object.keys(CATALOG_SORT_MAP) as (keyof typeof CATALOG_SORT_MAP)[]) {
        const sort = CATALOG_SORT_MAP[key];
        expect(catalogSortKeyFromQuery(sort.sortBy, sort.sortOrder)).toBe(key);
        expect(resolveCatalogSort(sort.sortBy, sort.sortOrder)).toEqual(sort);
      }
    });
  });
});
