/**
 * BCP-47 region-qualified locale codes for the storefront.
 *
 * Single source of truth for (a) `<html lang>` + `hreflang` (hyphenated form)
 * and (b) Open Graph `og:locale` (underscore form per the OG spec).
 *
 * The region tail is the store's country, from `identity.address.country` in
 * the runtime config, exactly as the API half derives it
 * (`apps/api/src/modules/seo/locale-region.ts`, config-driven since plan
 * E1.3). Before plan E2.3 this file held a literal map, so the two halves
 * could advertise different markets for one store.
 *
 * A store with no country configured advertises the bare language tag. That is
 * correct rather than convenient: a region tail names a market, and inventing
 * one for a store that has not said where it sells would be advertising a
 * market it does not serve.
 *
 * Authority: `agent_docs/storefront/seo-geo.md` "## OG locale convention".
 */

import type { Locale } from '../i18n/types';

/** The shape a caller needs to resolve a region tail: the store's country. */
export interface RegionSource {
  /** ISO 3166-1 alpha-2, or empty when the store has not configured one. */
  country: string;
}

/** BCP-47 hyphen form: `fr-LY`, `en-LY`. Used by `<html lang>` + `hreflang`. */
export function regionFromLocale(locale: Locale, source: RegionSource): string {
  const country = source.country.trim().toUpperCase();
  return country ? `${locale}-${country}` : locale;
}

/** Open Graph form: `fr_LY`. Same region info, the separator the OG spec wants. */
export function ogLocaleFromLocale(locale: Locale, source: RegionSource): string {
  return regionFromLocale(locale, source).replace('-', '_');
}

/**
 * OG-format codes for every locale OTHER than the resolved one, across the
 * locales the store actually serves.
 *
 * The OG spec advertises equivalent variants, never the page's own locale, and
 * a store must not advertise a locale it does not serve, so the caller passes
 * its configured set rather than the build catalogue.
 */
export function ogLocaleAlternates(
  currentLocale: Locale,
  supportedLocales: readonly Locale[],
  source: RegionSource,
): string[] {
  return supportedLocales
    .filter((l) => l !== currentLocale)
    .map((l) => ogLocaleFromLocale(l, source));
}

/**
 * `og:locale` codes keyed by locale, for a caller that wants the whole map.
 *
 * Derived here rather than declared in `i18n/types.ts`, which is where a
 * second copy of the region info used to live: a page could declare one region
 * for itself and another for its sibling because `seo.ts` read the constant
 * while the alternates came from this file.
 */
export function localeOgTags(
  locales: readonly Locale[],
  source: RegionSource,
): Record<string, string> {
  return Object.fromEntries(locales.map((l) => [l, ogLocaleFromLocale(l, source)]));
}
