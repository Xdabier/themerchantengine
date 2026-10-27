import { LOCALE_REGISTRY, type LocaleDefinition } from './locale-registry';
import type { LocaleSet } from './store-locales';

/** A French-led two-locale store, for specs that assert fr or en copy. */
export const FR_EN_LOCALE_SET: LocaleSet = Object.freeze({
  supportedLocales: Object.freeze(['fr', 'en']),
  defaultLocale: 'fr',
  rtlLocales: Object.freeze([]),
  timezone: 'UTC',
});

/**
 * Adds a throwaway language to the registry for a spec that proves a fourth
 * locale works end to end. Returns the function that removes it again.
 */
export function registerScratchLocale(code: string, direction: 'ltr' | 'rtl' = 'ltr'): () => void {
  const registry = LOCALE_REGISTRY as Record<string, LocaleDefinition>;
  registry[code] = {
    code,
    label: `Scratch ${code}`,
    nativeName: `Scratch ${code}`,
    direction,
    script: direction === 'rtl' ? 'arabic' : 'latin',
    intlTag: code,
    ogRegion: 'ZZ',
    textSearchConfig: 'simple',
    typography: { spaceBeforeHighPunctuation: false },
  };
  return () => {
    delete registry[code];
  };
}
