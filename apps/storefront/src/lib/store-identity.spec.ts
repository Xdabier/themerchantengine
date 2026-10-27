import { describe, expect, it } from 'vitest';

import { NEUTRAL_CHROME_IDENTITY } from '../i18n';
import { organizationJsonLd } from './seo';
import { buildStoreIdentity, type StoreIdentitySource } from './store-identity';

/**
 * The blank-store-name case. `organizationJsonLdSchema` requires a non-empty
 * `name`, the wire schema allows a blank `identity.storeName` on a store nobody
 * has finished configuring, and the builder runs inside `ngOnInit`, so passing
 * the raw value through threw and took the home and about pages down at SSR.
 */

function source(overrides: Partial<{ storeName: string; areaServed: string[] }> = {}) {
  return {
    identity: () => ({
      storeName: overrides.storeName ?? 'Configured Store',
      description: 'A description',
      areaServed: overrides.areaServed ?? ['FR'],
    }),
    contactEmail: () => null,
    phone: () => null,
    logoUrl: () => null,
    socialLinks: () => [],
  } satisfies StoreIdentitySource;
}

describe('buildStoreIdentity', () => {
  it('passes the configured store name through', () => {
    const built = buildStoreIdentity(source(), { storeName: 'Configured Store', country: 'FR' });
    expect(built.storeName).toBe('Configured Store');
  });

  it('never yields an empty store name', () => {
    const built = buildStoreIdentity(source({ storeName: '' }), NEUTRAL_CHROME_IDENTITY);
    expect(built.storeName).toBe(NEUTRAL_CHROME_IDENTITY.storeName);
    expect(built.storeName.length).toBeGreaterThan(0);
  });

  it('builds a payload the Organization schema accepts for an unnamed store', () => {
    // The regression itself: this threw, inside ngOnInit, on every render.
    const built = buildStoreIdentity(source({ storeName: '' }), NEUTRAL_CHROME_IDENTITY);
    expect(() => organizationJsonLd('en', 'https://demo.test', built)).not.toThrow();
    expect(organizationJsonLd('en', 'https://demo.test', built).name).toBe(
      NEUTRAL_CHROME_IDENTITY.storeName,
    );
  });

  it('omits areaServed for a store that serves nowhere in particular', () => {
    const built = buildStoreIdentity(
      source({ storeName: '', areaServed: [] }),
      NEUTRAL_CHROME_IDENTITY,
    );
    expect(organizationJsonLd('en', 'https://demo.test', built).areaServed).toBeUndefined();
  });
});
