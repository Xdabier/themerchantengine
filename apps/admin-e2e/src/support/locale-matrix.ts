import { test } from '@playwright/test';

import { activeStoreConfigFixture } from '@common/store-config-fixtures';

/**
 * Locale-matrix helper for admin Playwright specs, the counterpart of the
 * storefront helper of the same name.
 *
 * The set is not a literal: it is the locales the target under test serves
 * (`STORE_CONFIG_FIXTURE`, `demo` when the harness pins none), default first.
 * Translatable fields in the admin show one tab per enabled locale, so a
 * journey that only ever touches the default tab never sees a missing or
 * wrong-language value on the others.
 *
 *   describeEveryLocale('cms page editor', (locale) => {
 *     test(`shows the ${locale} title`, async ({ page }) => { ... });
 *   });
 */
const localization = activeStoreConfigFixture().localization;

export type AdminLocale = (typeof localization.supportedLocales)[number];

export const ADMIN_LOCALES: readonly AdminLocale[] = [
  localization.defaultLocale,
  ...localization.supportedLocales.filter((locale) => locale !== localization.defaultLocale),
];

/** A value that names its locale, so a wrong-tab render is visible in the failure. */
export function localizedValue(label: string, locale: AdminLocale): string {
  return `${label} [${locale}]`;
}

/** One `{ locale: value }` object covering every served locale, `default` included. */
export function translatableForEveryLocale(label: string): Record<string, string> {
  const value: Record<string, string> = { default: localizedValue(label, ADMIN_LOCALES[0]) };
  for (const locale of ADMIN_LOCALES) value[locale] = localizedValue(label, locale);
  return value;
}

export function describeEveryLocale(name: string, body: (locale: AdminLocale) => void): void {
  for (const locale of ADMIN_LOCALES) {
    test.describe(`${name} @${locale}`, () => body(locale));
  }
}
