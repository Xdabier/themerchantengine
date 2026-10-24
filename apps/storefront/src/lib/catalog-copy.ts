import type { ChromeStrings } from '../i18n/types';

/**
 * Result-count copy for the catalogue and category grids.
 *
 * `catalog.results.count` is a plural template, and both pages interpolated it
 * with no singular branch, so one match read "1 products" (finding C12). The
 * search page already carried the singular / plural pair; this helper is the
 * one place both catalogue pages get it from.
 */
export function resultsCountLabel(total: number, strings: ChromeStrings): string {
  const copy = strings.catalog.results;
  if (total <= 0) return copy.zero;
  if (total === 1) return copy.countSingular;
  return copy.count.replace('{count}', String(total));
}
