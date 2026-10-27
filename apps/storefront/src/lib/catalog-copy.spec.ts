import { describe, expect, it } from 'vitest';

import { getChromeStrings } from '../i18n';
import { resultsCountLabel } from './catalog-copy';

/**
 * Finding C12 (plan L Phase L4).
 *
 * `catalog.results.count` was interpolated with no singular branch, so a
 * catalogue narrowed to one product read "1 products" in English and
 * "1 produits" in French. The search page already had the pattern; this is the
 * one helper both catalogue pages now share.
 */
describe('resultsCountLabel', () => {
  it('uses the singular form for one result', () => {
    expect(resultsCountLabel(1, getChromeStrings('en'))).toBe('1 product');
    expect(resultsCountLabel(1, getChromeStrings('fr'))).toBe('1 produit');
  });

  it('uses the plural template for anything else', () => {
    expect(resultsCountLabel(10, getChromeStrings('en'))).toBe('10 products');
    expect(resultsCountLabel(10, getChromeStrings('fr'))).toBe('10 produits');
  });

  it('uses the zero copy when nothing matched', () => {
    expect(resultsCountLabel(0, getChromeStrings('en'))).toBe('No products');
    expect(resultsCountLabel(0, getChromeStrings('fr'))).toBe('Aucun produit');
  });
});
