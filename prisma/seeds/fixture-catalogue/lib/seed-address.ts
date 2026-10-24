import type { StoreRuntimeConfig } from '../../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';

/** A postal address in the shape the seed writes into JSONB address columns. */
export interface SeedAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  country: string;
}

/**
 * An address in the market the store actually serves (plan E2.6).
 *
 * The seeded customer and the seeded order carried a fixed address in the
 * retired client's city. Under any other configuration that address is in a
 * country the domestic shipping zone does not cover, because
 * `prisma/seeds/store-config/shipping.ts` builds the zone from
 * `identity.address.country`: the seeded customer could not be shipped to by
 * the store that seeded them. The client-reference guard could not see it
 * either, since a city name is not one of its tokens.
 *
 * Derived from the same place the e2e helper `fixtureShippableAddress()`
 * derives from, so the seed and the harness cannot disagree about where the
 * store delivers.
 */
export function seedAddress(
  identity: StoreRuntimeConfig['identity'],
  fullName: string,
): SeedAddress {
  return {
    fullName,
    phone: identity.contact.phone,
    addressLine1: identity.address.street.default,
    city: identity.address.locality,
    country: identity.address.country,
  };
}

/** The warehouse the fixture catalogue stocks, in the store's own market. */
export function seedWarehouseAddress(identity: StoreRuntimeConfig['identity']): {
  line1: string;
  city: string;
  country: string;
} {
  return {
    line1: 'Logistics City, Industrial Zone',
    city: identity.address.locality,
    country: identity.address.country,
  };
}
