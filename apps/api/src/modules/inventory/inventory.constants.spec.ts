import { LOW_STOCK_THRESHOLD, STOCK_STATUSES, stockStatusFor } from './inventory.constants';

// The three-state availability the storefront card and product page render is
// derived from this one function, so its boundaries are pinned directly here
// rather than only through the callers that consume them.
describe('stockStatusFor', () => {
  it('reports OUT_OF_STOCK at zero', () => {
    expect(stockStatusFor(0, 5)).toBe('OUT_OF_STOCK');
  });

  it('reports OUT_OF_STOCK below zero', () => {
    expect(stockStatusFor(-3, 5)).toBe('OUT_OF_STOCK');
  });

  it('reports LOW_STOCK at one, the first unit above zero', () => {
    expect(stockStatusFor(1, 5)).toBe('LOW_STOCK');
  });

  it('reports LOW_STOCK when onHand equals the threshold', () => {
    expect(stockStatusFor(5, 5)).toBe('LOW_STOCK');
  });

  it('reports IN_STOCK one unit above the threshold', () => {
    expect(stockStatusFor(6, 5)).toBe('IN_STOCK');
  });

  it('reports IN_STOCK well above the threshold', () => {
    expect(stockStatusFor(500, 5)).toBe('IN_STOCK');
  });

  it('never reports LOW_STOCK when the threshold is zero', () => {
    expect(stockStatusFor(0, 0)).toBe('OUT_OF_STOCK');
    expect(stockStatusFor(1, 0)).toBe('IN_STOCK');
  });

  it('returns only members of STOCK_STATUSES', () => {
    for (const onHand of [-1, 0, 1, 10, 11]) {
      expect(STOCK_STATUSES).toContain(stockStatusFor(onHand, LOW_STOCK_THRESHOLD));
    }
  });
});
