import { describe, expect, it } from 'vitest';

import {
  buildLocaleSwitchHref,
  localeFromAcceptLanguage,
  localeFromCookieHeader,
  localeFromPathname,
  resolveLocaleFromHeaders,
  routeLocale,
} from './locale';

describe('localeFromPathname', () => {
  it('extracts fr from /fr paths', () => {
    expect(localeFromPathname('/fr/')).toBe('fr');
    expect(localeFromPathname('/fr')).toBe('fr');
    expect(localeFromPathname('/fr/catalog/electronics')).toBe('fr');
  });

  it('extracts en from /en paths', () => {
    expect(localeFromPathname('/en/cart')).toBe('en');
  });

  it('returns null for unsupported or rootless paths', () => {
    expect(localeFromPathname('/')).toBeNull();
    expect(localeFromPathname('/de/')).toBeNull();
    // `ar` is in the catalogue now, so a path prefixed with it is a locale
    // path even where the store does not serve it. Whether the store serves
    // it is a config question the redirect middleware answers, not a parse.
    expect(localeFromPathname('/ar/')).toBe('ar');
    expect(localeFromPathname('/de/')).toBeNull();
    expect(localeFromPathname('/about')).toBeNull();
  });
});

describe('routeLocale', () => {
  it('returns the matched [locale] route param', () => {
    expect(routeLocale({ locale: 'en' })).toBe('en');
    expect(routeLocale({ locale: 'fr' })).toBe('fr');
    // Extra params (e.g. slug) do not interfere.
    expect(routeLocale({ locale: 'en', slug: 'privacy' })).toBe('en');
  });

  it('returns null for an absent, unrecognised, or non-string locale param', () => {
    expect(routeLocale({})).toBeNull();
    expect(routeLocale({ locale: 'de' })).toBeNull();
    expect(routeLocale({ locale: 'ar' })).toBe('ar');
    expect(routeLocale({ locale: 'de' })).toBeNull();
    expect(routeLocale({ locale: '' })).toBeNull();
    expect(routeLocale({ locale: 42 })).toBeNull();
    expect(routeLocale(null)).toBeNull();
    expect(routeLocale(undefined)).toBeNull();
  });
});

describe('localeFromAcceptLanguage', () => {
  it('honours quality values', () => {
    expect(localeFromAcceptLanguage('en-US,en;q=0.9,fr;q=0.5')).toBe('en');
    expect(localeFromAcceptLanguage('fr-TN,fr;q=0.9,en;q=0.5')).toBe('fr');
  });

  it('falls back through unsupported tags', () => {
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,en;q=0.4')).toBe('en');
    expect(localeFromAcceptLanguage('ar-QA,ar;q=0.9,fr;q=0.4')).toBe('ar');
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,ar;q=0.4')).toBe('ar');
  });

  it('returns null when nothing matches', () => {
    expect(localeFromAcceptLanguage('de-DE,it;q=0.5')).toBeNull();
    expect(localeFromAcceptLanguage('it-IT,it;q=0.5')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage('')).toBeNull();
  });

  it('skips a catalogue locale the store does not serve, rather than stopping at it', () => {
    // The defect: the highest-q catalogue locale won outright and the caller
    // then discarded it for being unserved, so the next candidate never got a
    // turn. A reader who prefers Arabic and accepts French landed on the
    // store's default instead of on French.
    expect(localeFromAcceptLanguage('ar,fr;q=0.9,en;q=0.5', ['fr', 'en'])).toBe('fr');
    expect(localeFromAcceptLanguage('ar-QA,ar;q=0.9,fr-BE;q=0.4', ['fr', 'en'])).toBe('fr');
  });

  it('still honours quality order among the locales the store does serve', () => {
    expect(localeFromAcceptLanguage('en;q=0.5,fr;q=0.9', ['fr', 'en'])).toBe('fr');
    expect(localeFromAcceptLanguage('fr;q=0.4,en;q=0.8', ['fr', 'en'])).toBe('en');
  });

  it('returns null when the store serves none of the accepted locales', () => {
    expect(localeFromAcceptLanguage('ar,de;q=0.5', ['fr', 'en'])).toBeNull();
  });

  it('matches every catalogue locale when the caller supplies no set', () => {
    // The client-side last resort has no config to read, and that contract
    // stays: an omitted set means the whole build catalogue is eligible.
    expect(localeFromAcceptLanguage('ar,fr;q=0.9')).toBe('ar');
  });
});

describe('localeFromCookieHeader', () => {
  it('parses the requested cookie name', () => {
    expect(localeFromCookieHeader('storefront_locale=fr; other=foo', 'storefront_locale')).toBe(
      'fr',
    );
    expect(localeFromCookieHeader('other=foo; storefront_locale=en', 'storefront_locale')).toBe(
      'en',
    );
  });

  it('returns null when missing or unsupported', () => {
    expect(localeFromCookieHeader('storefront_locale=de', 'storefront_locale')).toBeNull();
    expect(localeFromCookieHeader('storefront_locale=de', 'storefront_locale')).toBeNull();
    expect(localeFromCookieHeader('', 'storefront_locale')).toBeNull();
    expect(localeFromCookieHeader(null, 'storefront_locale')).toBeNull();
  });
});

describe('buildLocaleSwitchHref', () => {
  it('swaps the locale prefix while preserving path, query, and fragment', () => {
    expect(buildLocaleSwitchHref('/fr/', 'en')).toBe('/en/');
    expect(buildLocaleSwitchHref('/en/', 'fr')).toBe('/fr/');
    expect(buildLocaleSwitchHref('/fr/catalog', 'en')).toBe('/en/catalog');
    expect(buildLocaleSwitchHref('/en/catalog/electronics', 'fr')).toBe('/fr/catalog/electronics');
    expect(buildLocaleSwitchHref('/fr/_smoke/services?ref=home#tabs', 'en')).toBe(
      '/en/_smoke/services?ref=home#tabs',
    );
    expect(buildLocaleSwitchHref('/en/cart?ref=home', 'fr')).toBe('/fr/cart?ref=home');
  });

  it('returns the original href when no locale prefix is present', () => {
    expect(buildLocaleSwitchHref('/', 'en')).toBe('/');
    expect(buildLocaleSwitchHref('/about', 'en')).toBe('/about');
    expect(buildLocaleSwitchHref('/healthz', 'fr')).toBe('/healthz');
  });

  it('does not match locale-like prefixes that lack a trailing slash boundary', () => {
    expect(buildLocaleSwitchHref('/french/x', 'en')).toBe('/french/x');
    expect(buildLocaleSwitchHref('/english/x', 'fr')).toBe('/english/x');
  });

  it('preserves trailing slash when present', () => {
    expect(buildLocaleSwitchHref('/fr/catalog/', 'en')).toBe('/en/catalog/');
  });
});

describe('resolveLocaleFromHeaders', () => {
  it('prefers the explicit cookie over Accept-Language', () => {
    expect(
      resolveLocaleFromHeaders({
        acceptLanguage: 'fr-TN,fr;q=0.9',
        cookie: 'storefront_locale=en',
        cookieName: 'storefront_locale',
      }),
    ).toBe('en');
  });

  it('keeps the cookie ahead of Accept-Language in the other direction too', () => {
    // Mirror of the case above. If the two inputs ever swap priority again,
    // one of the pair still passes by accident, so both are pinned.
    expect(
      resolveLocaleFromHeaders({
        acceptLanguage: 'en-US,en;q=0.9',
        cookie: 'storefront_locale=fr',
        cookieName: 'storefront_locale',
      }),
    ).toBe('fr');
  });

  it('falls back to Accept-Language when the cookie is absent or unsupported', () => {
    expect(
      resolveLocaleFromHeaders({
        acceptLanguage: 'en-US,en;q=0.9',
        cookie: null,
        cookieName: 'storefront_locale',
      }),
    ).toBe('en');

    // A cookie naming a catalogue locale the store does not serve is skipped
    // rather than honoured: it was set by another install or another visit.
    expect(
      resolveLocaleFromHeaders({
        acceptLanguage: 'en-US,en;q=0.9',
        cookie: 'storefront_locale=ar',
        cookieName: 'storefront_locale',
        supported: ['fr', 'en'],
        defaultLocale: 'fr',
      }),
    ).toBe('en');

    // With no configured set the cookie wins, which is the unconfigured case.
    expect(
      resolveLocaleFromHeaders({
        acceptLanguage: 'en-US,en;q=0.9',
        cookie: 'storefront_locale=ar',
        cookieName: 'storefront_locale',
      }),
    ).toBe('ar');

    // And the store's own default is what an unmatched request lands on.
    expect(
      resolveLocaleFromHeaders({
        acceptLanguage: 'de-DE',
        cookie: null,
        cookieName: 'storefront_locale',
        supported: ['ar', 'en'],
        defaultLocale: 'ar',
      }),
    ).toBe('ar');
  });

  it('falls back to the default locale when neither cookie nor header resolves', () => {
    expect(
      resolveLocaleFromHeaders({
        acceptLanguage: null,
        cookie: null,
        cookieName: 'storefront_locale',
      }),
    ).toBe('fr');

    expect(
      resolveLocaleFromHeaders({
        acceptLanguage: 'de-DE,de;q=0.9',
        cookie: 'storefront_locale=de',
        cookieName: 'storefront_locale',
      }),
    ).toBe('fr');
  });
});
