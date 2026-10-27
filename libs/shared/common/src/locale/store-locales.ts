import {
  isRegistryLocale,
  LOCALE_REGISTRY,
  registryLocaleCodes,
  type RegistryLocale,
} from './locale-registry';

/**
 * The locale set of the running store (DR-31, plan E1.3): which locales it
 * has enabled, which one is its default, and which render right-to-left.
 *
 * The values come from the runtime config (`localization` group). They are
 * read on almost every request, by code that has no request scope (the mail
 * renderer, the SEO processors, the global Translatable interceptor built in
 * `main.ts` with `new`), so they live in one process-wide snapshot rather
 * than behind an async settings read. The API's `StoreLocaleRegistry` loads
 * the snapshot at boot and replaces it on every `store-config.updated`
 * event; nothing else writes it.
 */

/** Locales the engine ships string catalogues for; a store enables a subset. */
export const LOCALE_CATALOGUE: readonly RegistryLocale[] = registryLocaleCodes();
export type CatalogueLocale = RegistryLocale;

export function isCatalogueLocale(value: string): value is CatalogueLocale {
  return isRegistryLocale(value);
}

export interface LocaleSet {
  supportedLocales: readonly string[];
  defaultLocale: string;
  rtlLocales: readonly string[];
  /** IANA zone every customer-facing date is written in. */
  timezone: string;
}

/** What a consumer needs to resolve a Translatable: the set and its default. */
export interface LocaleSource {
  current(): LocaleSet;
}

/**
 * The neutral set a fresh engine boots with until the settings load. Mirrors
 * `STORE_CONFIG.localization` in the API, which imports it from here so the
 * two cannot drift.
 */
const NEUTRAL_DEFAULT_LOCALE: RegistryLocale = 'ar';

export const NEUTRAL_LOCALE_SET: LocaleSet = Object.freeze({
  supportedLocales: Object.freeze([
    NEUTRAL_DEFAULT_LOCALE,
    ...registryLocaleCodes().filter((code) => code !== NEUTRAL_DEFAULT_LOCALE),
  ]),
  defaultLocale: NEUTRAL_DEFAULT_LOCALE,
  rtlLocales: Object.freeze(
    registryLocaleCodes().filter((code) => LOCALE_REGISTRY[code].direction === 'rtl'),
  ),
  timezone: 'UTC',
});

export class StoreLocales implements LocaleSource {
  private snapshot: LocaleSet;

  constructor(initial: LocaleSet = NEUTRAL_LOCALE_SET) {
    this.snapshot = normalise(initial);
  }

  current(): LocaleSet {
    return this.snapshot;
  }

  /** Replaces the snapshot. Unknown locales are dropped, never stored. */
  set(next: LocaleSet): void {
    this.snapshot = normalise(next);
  }

  isSupported(locale: string): boolean {
    return this.snapshot.supportedLocales.includes(locale);
  }

  isRtl(locale: string): boolean {
    return this.snapshot.rtlLocales.includes(locale);
  }

  /** `rtl` or `ltr`, for `<html dir>` and mail layouts. */
  direction(locale: string): 'rtl' | 'ltr' {
    return this.isRtl(locale) ? 'rtl' : 'ltr';
  }
}

/**
 * Clips a set to the catalogue and keeps it self-consistent: the default is
 * always inside the supported set, the RTL set is always inside it too. A
 * row an operator narrowed after the fact can therefore never leave the
 * process resolving to a locale it has no strings for.
 */
export function normalise(set: LocaleSet): LocaleSet {
  const supported = set.supportedLocales.filter(isCatalogueLocale);
  if (supported.length === 0) {
    return Object.freeze({
      ...NEUTRAL_LOCALE_SET,
      timezone: validTimezone(set.timezone) ? set.timezone : NEUTRAL_LOCALE_SET.timezone,
    });
  }
  const supportedLocales: string[] = supported;
  const defaultLocale = supportedLocales.includes(set.defaultLocale)
    ? set.defaultLocale
    : supportedLocales[0];
  const rtlLocales = set.rtlLocales.filter((locale) => supportedLocales.includes(locale));
  return Object.freeze({
    supportedLocales: Object.freeze(supportedLocales),
    defaultLocale,
    rtlLocales: Object.freeze(rtlLocales),
    timezone: validTimezone(set.timezone) ? set.timezone : NEUTRAL_LOCALE_SET.timezone,
  });
}

/** `Intl` is the judge: a zone it refuses would make every date formatter throw. */
function validTimezone(zone: string | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** A fixed source, for tests and for tools that run outside the API. */
export function staticLocaleSource(
  supportedLocales: readonly string[],
  defaultLocale: string,
  rtlLocales: readonly string[] = [],
  timezone: string = NEUTRAL_LOCALE_SET.timezone,
): LocaleSource {
  return new StoreLocales({ supportedLocales, defaultLocale, rtlLocales, timezone });
}

/** The one snapshot the running process resolves against. */
export const storeLocales = new StoreLocales();
