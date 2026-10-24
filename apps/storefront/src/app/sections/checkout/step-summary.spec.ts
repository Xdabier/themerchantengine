import { describe, expect, it } from 'vitest';

import type { Cart } from '@storefront-types';

import { getChromeStrings } from '../../../i18n';
import { fixtureMoney, fixtureRuntimeConfig } from '../../../test-support/store-config-fixtures';
import { buildStepSummary } from './step-summary';

/**
 * The collapsed step-2 recap (finding K3), and the tax mention gate A handed to
 * gate B: it read `generic.taxIncluded` unconditionally, which is wrong for a
 * store that shows no mention at all and wrong again for a figure that is not
 * tax-inclusive (plan E2.5, B2.9).
 */

const STRINGS = getChromeStrings('en');
const MONEY = fixtureMoney('demo');
const CURRENCY = fixtureRuntimeConfig('demo').money.currencyCode;

function cart(overrides: Record<string, unknown> = {}): Cart {
  return {
    items: [{ id: 'i1' }, { id: 'i2' }],
    currency: CURRENCY,
    ...overrides,
  } as unknown as Cart;
}

describe('buildStepSummary', () => {
  it('returns nothing without a cart', () => {
    expect(buildStepSummary(null, STRINGS, MONEY, 'TTC')).toBeNull();
    expect(buildStepSummary(undefined, STRINGS, MONEY, 'TTC')).toBeNull();
  });

  it('falls back to the item count when no total has resolved', () => {
    const summary = buildStepSummary(cart(), STRINGS, MONEY, 'TTC');
    expect(summary).toBe(STRINGS.checkout.steps.itemsCount.replace('{count}', '2'));
  });

  it('uses the singular count copy for one item', () => {
    const summary = buildStepSummary(cart({ items: [{ id: 'i1' }] }), STRINGS, MONEY, 'TTC');
    expect(summary).toBe(STRINGS.checkout.steps.itemsCountOne);
  });

  it('labels a tax-inclusive total as tax-inclusive', () => {
    const summary = buildStepSummary(cart({ grandTotalTtc: 120 }), STRINGS, MONEY, 'TTC');
    expect(summary).toContain(STRINGS.generic.taxIncluded);
    expect(summary).not.toContain(STRINGS.generic.taxExcluded);
  });

  it('labels an ex-tax total as ex-tax under a tax-exclusive store', () => {
    // The API has not resolved a tax zone, so the only figure is `grandTotal`.
    // Calling that tax-inclusive is the defect this closes.
    const summary = buildStepSummary(cart({ grandTotal: 100 }), STRINGS, MONEY, 'HT');
    expect(summary).toContain(STRINGS.generic.taxExcluded);
    expect(summary).not.toContain(STRINGS.generic.taxIncluded);
  });

  it('still says tax-inclusive under a tax-inclusive store when the figure is', () => {
    const summary = buildStepSummary(cart({ grandTotalTtc: 120 }), STRINGS, MONEY, 'HT');
    expect(summary).toContain(STRINGS.generic.taxIncluded);
  });

  it('shows no mention at all for a store configured to show none', () => {
    const summary = buildStepSummary(cart({ grandTotalTtc: 120 }), STRINGS, MONEY, 'none');
    expect(summary).not.toContain(STRINGS.generic.taxIncluded);
    expect(summary).not.toContain(STRINGS.generic.taxExcluded);
    // And no placeholder, and no dangling separator where the mention was.
    expect(summary).not.toContain('{taxMention}');
    expect(summary?.trimEnd()).toBe(summary);
  });

  it('quotes the total in the store money format', () => {
    const summary = buildStepSummary(cart({ grandTotalTtc: 1234.5 }), STRINGS, MONEY, 'TTC');
    expect(summary).toContain(MONEY.symbol);
    expect(summary).toContain(MONEY.decimalSeparator);
  });
});
