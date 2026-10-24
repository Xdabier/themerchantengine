import type { ChromeIdentity } from '../i18n';
import type { StoreIdentityInput } from './seo';

/** The subset of `StoreConfigService` this builder reads. */
export interface StoreIdentitySource {
  identity: () => { storeName: string; description: string; areaServed: readonly string[] };
  contactEmail: () => string | null;
  phone: () => string | null;
  logoUrl: () => string | null;
  socialLinks: () => readonly { platform: string; url: string }[];
}

/**
 * The operator-configured half of the Organization payload.
 *
 * One builder rather than one per page (§3.14): the home page and the about
 * page each carried a private copy, and when the store name became a required
 * input both copies passed it straight through.
 *
 * The name comes from the resolved chrome identity, not from the raw config.
 * The wire schema allows a blank `storeName` on a store nobody has finished
 * configuring, `organizationJsonLdSchema` requires a non-empty `name`, and the
 * builder runs inside `ngOnInit`, so a blank one threw and took the whole page
 * down at SSR. `chromeIdentity` already substitutes the neutral store's name
 * for a blank one, which is the same value every other surface falls back to.
 */
export function buildStoreIdentity(
  config: StoreIdentitySource,
  chrome: ChromeIdentity,
): StoreIdentityInput {
  const identity = config.identity();
  return {
    storeName: chrome.storeName,
    description: identity.description,
    areaServed: identity.areaServed,
    contactEmail: config.contactEmail(),
    phone: config.phone(),
    logoUrl: config.logoUrl(),
    socialLinks: config.socialLinks(),
  };
}
