/**
 * BCP-47 region-qualified locale codes for the API.
 *
 * Single source for (a) sitemap `<xhtml:link hreflang>` emit, (b) the
 * `hreflang` set on meta tags and (c) any JSON-LD that names a locale. The
 * region tail is the store's country from the runtime config
 * (`identity.address.country`, stored as `business.addressCountry`), so the
 * markets a store advertises to crawlers and the country it says it serves
 * can never disagree (DR-31, plan E1.3.6). A store that has not set a country
 * yet emits the bare language tag, which every crawler accepts.
 *
 * Authority: `agent_docs/storefront/seo-geo.md` "## OG locale convention".
 * The storefront computes the same form from the same config in E2.3.
 */

/** `fr` + `LY` gives `fr-LY`; `fr` with no country gives `fr`. */
export function regionFromLocale(locale: string, country: string | null | undefined): string {
  const tail = typeof country === 'string' ? country.trim().toUpperCase() : '';
  const language = locale.split('-')[0];
  return /^[A-Z]{2}$/.test(tail) ? `${language}-${tail}` : language;
}

/** Open Graph wants the underscore form: `fr_LY`. */
export function ogLocaleFromLocale(locale: string, country: string | null | undefined): string {
  return regionFromLocale(locale, country).replace('-', '_');
}
