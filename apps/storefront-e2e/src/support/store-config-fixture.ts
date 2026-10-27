/**
 * Which scenario store config the target under test was seeded from
 * (plan E0.4). The helpers live in the shared loader; this file only gives
 * storefront specs a local import path.
 */
import {
  DEFAULT_STORE_CONFIG_FIXTURE,
  harnessStoreConfigFixtureId,
  loadStoreConfigFixture,
  StoreConfigFixture,
} from '@common/store-config-fixtures';

export {
  describeHarnessStoreConfig,
  harnessStoreConfigFixture,
  harnessStoreConfigFixtureId,
} from '../../../../libs/shared/common/src/store-config-fixtures';

/**
 * The config the target under test is running, for a spec that needs a value
 * rather than a nullable answer.
 *
 * `harnessStoreConfigFixture()` returns null when `STORE_CONFIG_FIXTURE` is
 * unset, which is what tells a caller "the harness pinned no fixture". A spec
 * asserting a rendered price cannot use that: it needs the config the store
 * actually serves. `scripts/seed-storefront-test.ts` names
 * `DEFAULT_STORE_CONFIG_FIXTURE` when the environment does not, and so does
 * this, so an unpinned run is that fixture's run rather than whatever the last
 * harness left behind (plan E2.6). Both read the one constant: two spellings of
 * the same default would drift the first time it changed.
 */
export function activeStoreConfigFixture(): StoreConfigFixture {
  return loadStoreConfigFixture(harnessStoreConfigFixtureId() ?? DEFAULT_STORE_CONFIG_FIXTURE);
}

/**
 * The tax mention the store is configured to render beside a price: `HT`,
 * `TTC`, or nothing at all.
 *
 * A spec that hardcoded `HT` was asserting one store's tax policy. Under a
 * fixture that displays tax-inclusive prices, or one that shows no mention,
 * the same assertion is wrong rather than merely different.
 */
export function configuredTaxDisplay(): 'HT' | 'TTC' | 'none' {
  return activeStoreConfigFixture().money.taxDisplay;
}

/** The configured VAT rate as a whole percent, for the copy that names it. */
export function configuredVatPercent(): number {
  return Math.round(activeStoreConfigFixture().money.vatRate * 100);
}

/**
 * A shipping address inside the active fixture's own country, for specs that
 * need a checkout address a domestic shipping zone actually covers.
 *
 * `identity.address` is where the store itself sits, and E1.4.3 seeds the
 * domestic tax/shipping zone from that same country, so an address elsewhere
 * (the previous client's `Tripoli, TN`, left over across three fixture
 * rewrites) matches no zone: checkout reports "No delivery method is
 * available for this address" and every mutation journey behind it never
 * gets past the delivery step. `overrides` lets a spec vary the recipient
 * name or keep testing a genuinely out-of-zone address on purpose.
 */
export function fixtureShippableAddress(
  overrides: Partial<{
    fullName: string;
    phone: string;
    addressLine1: string;
    city: string;
    postalCode: string;
    country: string;
  }> = {},
): {
  fullName: string;
  phone: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  country: string;
} {
  const { identity } = activeStoreConfigFixture();
  return {
    fullName: 'Fixture Customer',
    phone: identity.contact.phone,
    addressLine1: identity.address.street.default,
    city: identity.address.locality,
    postalCode: identity.address.postalCode,
    country: identity.address.country,
    ...overrides,
  };
}
