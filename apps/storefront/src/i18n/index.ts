import ar from './ar';
import { buildCatalogues } from './catalogue';
import en from './en';
import fr from './fr';
import { applyChromeIdentity, NEUTRAL_CHROME_IDENTITY, type ChromeIdentity } from './identity';
import { DEFAULT_LOCALE, isLocale, type ChromeStrings, type Locale } from './types';

/**
 * The chrome string catalogues, one per locale the engine ships.
 *
 * Built from the language registry: every registry locale has an entry, and a
 * key a catalogue lacks serves the default locale's string (DR-33).
 */
const STRINGS = buildCatalogues<ChromeStrings>({ fr, en, ar }, DEFAULT_LOCALE) as Record<
  Locale,
  ChromeStrings
>;

/**
 * Resolved catalogues, keyed by locale and by the identity filled into them.
 *
 * The cache is what lets `getChromeStrings` stay a pure function that every
 * `computed()` may call on every tick: an install has one identity, so this
 * holds one entry per locale in practice and the substitution runs once.
 */
const RESOLVED = new Map<string, ChromeStrings>();

/**
 * One entry per locale is the steady state. The bound exists because this map
 * lives for the life of the SSR process: a config that changed under it, or a
 * store name edited a hundred times in an afternoon, must not grow it without
 * end.
 */
const RESOLVED_MAX = 32;

/**
 * The chrome copy for a locale, with the store's identity filled in.
 *
 * The identity argument is optional so a caller that has no config to read
 * still gets a complete catalogue: it resolves against the neutral config
 * rather than returning raw `{store}` placeholders, because a placeholder that
 * reaches a page is worse than a generic store name (plan E2.5).
 */
export function getChromeStrings(
  locale: Locale | string | null | undefined,
  identity: ChromeIdentity = NEUTRAL_CHROME_IDENTITY,
): ChromeStrings {
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const key = `${resolved}\u0000${identity.storeName}\u0000${identity.country}`;
  const hit = RESOLVED.get(key);
  if (hit) return hit;
  const built = applyChromeIdentity(STRINGS[resolved], identity, resolved);
  if (RESOLVED.size >= RESOLVED_MAX) RESOLVED.clear();
  RESOLVED.set(key, built);
  return built;
}

export { ar, en, fr };
export * from './identity';
export * from './types';
