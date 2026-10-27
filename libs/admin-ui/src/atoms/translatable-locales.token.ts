import { InjectionToken, type Signal, signal } from '@angular/core';
import { NEUTRAL_LOCALE_SET } from '@common/locale';

/** Writing direction of one locale tab. */
export type LocaleDirection = 'ltr' | 'rtl';

/**
 * One Translatable editor tab: which locale it edits, and which way that
 * locale is written.
 *
 * The direction travels with the code rather than in a token of its own. An
 * editor that reads its tab list from one source and its directions from
 * another can render an Arabic tab left-to-right the moment the two disagree,
 * and nothing about that is visible in a test that only checks the tab list.
 */
export interface TranslatableLocaleTab {
  readonly code: string;
  readonly dir: LocaleDirection;
}

/**
 * The tabs used when nothing provides `TRANSLATABLE_LOCALES`: the neutral
 * locale set, default first. The first entry is the default locale, which the
 * Translatable atoms mirror into the `default` key.
 */
export const FALLBACK_TRANSLATABLE_LOCALE_TABS: readonly TranslatableLocaleTab[] = buildLocaleTabs(
  NEUTRAL_LOCALE_SET.supportedLocales,
  NEUTRAL_LOCALE_SET.defaultLocale,
  NEUTRAL_LOCALE_SET.rtlLocales,
);

/**
 * DI token for the store's locale tabs. Provided by the host app
 * (`apps/admin`) from `StoreSettingsStore.localeTabs` so admin-ui stays
 * decoupled from app-level state, exactly as `ASSET_PICKER_PERMISSIONS` does
 * for the operator's permission set.
 *
 * Every Translatable editor in the admin reads its tab list from here. Before
 * this token existed the list was a component-input default of `['en', 'ar']`
 * that no call site overrode, so adding a locale in Settings changed nothing
 * on any screen.
 *
 * Declared in a separate lightweight file so `app.config.ts` can import only
 * the token without pulling the atoms and their transitive dependencies into
 * the initial bundle, which has under 100 kB of headroom against its error
 * budget.
 */
export const TRANSLATABLE_LOCALES = new InjectionToken<Signal<readonly TranslatableLocaleTab[]>>(
  'TranslatableLocales',
  {
    providedIn: 'root',
    factory: () => signal(FALLBACK_TRANSLATABLE_LOCALE_TABS).asReadonly(),
  },
);

/**
 * Order a locale list so the store default leads.
 *
 * The single implementation of the rule, because the Translatable atoms mirror
 * the FIRST entry into the `default` key: production and the test double must
 * order identically or a spec proves a rule production no longer follows.
 */
export function orderLocaleTabs(supported: readonly string[], fallback: string): readonly string[] {
  if (!supported.includes(fallback)) return [fallback, ...supported];
  return [fallback, ...supported.filter((code) => code !== fallback)];
}

/**
 * The tab list an editor renders: the store's locales, default first, each
 * carrying the direction the store configured for it.
 *
 * `rtlLocales` is a settings key rather than a property of the language,
 * because the store decides which of its locales it writes right to left, so
 * a code absent from that list is left-to-right here even when the language
 * is conventionally the other way. That is the configured answer, not a guess.
 */
export function buildLocaleTabs(
  supported: readonly string[],
  fallback: string,
  rtlLocales: readonly string[] = [],
): readonly TranslatableLocaleTab[] {
  return orderLocaleTabs(supported, fallback).map((code) => ({
    code,
    dir: rtlLocales.includes(code) ? 'rtl' : 'ltr',
  }));
}

/** The codes of a tab list, for a consumer that needs no direction. */
export function localeTabCodes(tabs: readonly TranslatableLocaleTab[]): readonly string[] {
  return tabs.map((tab) => tab.code);
}
