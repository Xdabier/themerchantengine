import { test } from '@playwright/test';

import { StoreConfigLocale } from '@common/store-config-fixtures';

import { activeStoreConfigFixture } from './store-config-fixture';

/**
 * Locale-matrix helper for storefront Playwright specs.
 *
 * Wraps a body callback so it runs under every locale the target under test
 * actually serves, with each branch surfacing as its own
 * `test.describe('... @<locale>')`. A spec that hand-rolls
 * `for (const locale of ['fr', 'en'])` is exactly what this helper replaces.
 *
 * Since plan E2.3 the set is not a pair and not a literal: it comes from the
 * scenario fixture the target under test runs (`STORE_CONFIG_FIXTURE`, `demo`
 * when the harness pins none), along with the
 * default locale, the writing direction and the region tail. A matrix that
 * named its own locales could only ever be right for one install, and the
 * suite has to run against three.
 *
 * The 2026-05-14 review-eligibility error (B1) is why locale-matrix coverage is
 * MANDATORY on every mutation-bearing or error-bearing journey
 * (`specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B): a missing
 * translation on the non-default locale renders as an empty or wrong-language
 * surface under a perfectly valid 200, and a single-locale spec never sees it.
 * The `storefront-locale-matrix-auditor` agent enforces presence at phase exit.
 *
 * Usage:
 *
 *   import { describeEveryLocale } from './support/locale-matrix';
 *
 *   describeEveryLocale('reviews submission', (locale) => {
 *     test(`unverified visitor sees the localized error (${locale})`, async ({ page }) => {
 *       await page.goto(`/${locale}/catalog/product/...`);
 *       ...
 *     });
 *   });
 */
/**
 * A locale from the shared catalogue, not a free string: specs index copy maps
 * by it, and a widened type would turn a missing translation into an `any`
 * instead of a compile error.
 */
export type StorefrontLocale = StoreConfigLocale;

const fixture = activeStoreConfigFixture();
const COUNTRY = fixture.identity.address.country.toUpperCase();

/**
 * Default locale first, because specs that assert a fallback ordering rely on
 * that first entry being the store's default.
 */
export const STOREFRONT_LOCALES: readonly StorefrontLocale[] = [
  fixture.localization.defaultLocale,
  ...fixture.localization.supportedLocales.filter((l) => l !== fixture.localization.defaultLocale),
];

/** The store's default, for an `x-default` assertion. */
export const STOREFRONT_DEFAULT_LOCALE: StorefrontLocale = fixture.localization.defaultLocale;

/** Writing direction per locale, for the `<html dir>` assertions. */
export function directionOf(locale: StorefrontLocale): 'ltr' | 'rtl' {
  return fixture.localization.rtlLocales.includes(locale as never) ? 'rtl' : 'ltr';
}

/**
 * `og:locale` value the SEO layer emits per locale, region-tagged.
 *
 * Keyed only by the locales the store serves, which is why it is partial: a
 * catalogue locale the store has not enabled has no `og:locale` because no
 * page is served in it. Read it through `copyFor` to get the throw rather
 * than an `undefined` assertion.
 */
export const STOREFRONT_OG_LOCALES: Partial<Record<StorefrontLocale, string>> = Object.fromEntries(
  STOREFRONT_LOCALES.map((l) => [l, COUNTRY ? `${l}_${COUNTRY}` : l]),
);

/** `hreflang` value per locale. Rides alongside the `x-default` alternate. */
export const STOREFRONT_HREFLANGS: Partial<Record<StorefrontLocale, string>> = Object.fromEntries(
  STOREFRONT_LOCALES.map((l) => [l, COUNTRY ? `${l}-${COUNTRY}` : l]),
);

/** Another locale the store serves. Used by leak assertions: what must NOT render. */
export function otherLocale(locale: StorefrontLocale): StorefrontLocale {
  const other = STOREFRONT_LOCALES.find((candidate) => candidate !== locale);
  if (!other) throw new Error(`no counterpart locale for '${locale}'`);
  return other;
}

/** Every other locale the store serves, in registry order. */
export function otherLocales(locale: StorefrontLocale): StorefrontLocale[] {
  return STOREFRONT_LOCALES.filter((candidate) => candidate !== locale);
}

/**
 * Read a spec's per-locale copy for the locale being run.
 *
 * Specs hold small literal maps of expected strings. They were written when
 * the suite ran under one fixed pair of locales; under a fixture that serves
 * another they would silently index to `undefined` and assert against it, which
 * passes as often as it fails. This throws instead, naming the locale and
 * telling the reader which spec has to grow a translation, which is the
 * punch list plan E2.6 works through when it rebases the suite.
 */
export function copyFor<M extends Partial<Record<StorefrontLocale, unknown>>>(
  map: M,
  locale: StorefrontLocale,
): NonNullable<M[keyof M]> {
  // `keyof M`, not `StorefrontLocale`: the value type is the union of what the
  // map actually holds, so a spec covering two locales still reads a typed
  // object rather than the empty intersection of two and a missing third.
  const value = map[locale as keyof M] as NonNullable<M[keyof M]> | undefined;
  if (value === undefined) {
    throw new Error(
      `this spec has no '${locale}' copy; it covers ${Object.keys(map).join(', ')}. ` +
        `The active fixture serves ${STOREFRONT_LOCALES.join(', ')}.`,
    );
  }
  return value;
}

/**
 * Trim a Translatable payload to the locales the store serves, keeping
 * `default`. The API rejects a key for a locale that is not enabled (DR-33),
 * so a spec that posts copy for every catalogue locale fails on any fixture
 * that serves fewer.
 */
export function forFixtureLocales<M extends Record<string, unknown>>(map: M): Partial<M> {
  return Object.fromEntries(
    Object.entries(map).filter(
      ([key]) => key === 'default' || (STOREFRONT_LOCALES as readonly string[]).includes(key),
    ),
  ) as Partial<M>;
}

export function describeEveryLocale(name: string, body: (locale: StorefrontLocale) => void): void {
  for (const locale of STOREFRONT_LOCALES) {
    test.describe(`${name} @${locale}`, () => body(locale));
  }
}
