import { describe, expect, it } from 'vitest';

import ar from './ar';
import { buildCatalogues } from './catalogue';
import fr from './fr';
import en from './en';
import { getLocaleDefinition } from '@common/locale/locale-registry';
import { getChromeStrings, isLocale, LOCALE_CATALOGUE, LOCALE_INTL_TAG } from './index';

/** Every catalogue the build ships. A store enables a subset at runtime. */
const CATALOGUES = { fr, en, ar };

describe('i18n chrome maps', () => {
  it('every catalogue exposes an identical key shape', () => {
    // A key added to the contract is a compile-time edit in all three files.
    // This catches the other direction: a key quietly dropped from one of them.
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      expect(walkKeys(catalogue), locale).toEqual(walkKeys(fr));
    }
  });

  it('no catalogue carries a static language toggle label', () => {
    // The switcher lists native names from the locale registry instead.
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      expect(
        walkKeys(catalogue).filter((k) => k.endsWith('languageToggle')),
        locale,
      ).toEqual([]);
    }
  });

  it('a locale missing a key serves the default locale string for it', () => {
    // The real catalogues, one key blanked: the build must not ship a hole.
    const built = buildCatalogues<typeof fr>({ fr, en: { ...en, brand: undefined }, ar: {} }, 'fr');
    expect(built['en'].brand).toEqual(fr.brand);
    expect(built['en'].splash).toEqual(en.splash);
    expect(walkKeys(built['ar'])).toEqual(walkKeys(fr));
    expect(built['ar'].brand.name).toBe(fr.brand.name);
  });

  it('every brand string is non-empty in every locale', () => {
    for (const lang of Object.values(CATALOGUES)) {
      expect(lang.brand.name.trim().length).toBeGreaterThan(0);
      expect(lang.brand.tagline.trim().length).toBeGreaterThan(0);
      expect(lang.splash.heading.trim().length).toBeGreaterThan(0);
    }
  });

  it('every auth chrome leaf is a non-empty string in every locale', () => {
    for (const lang of Object.values(CATALOGUES)) {
      const leaves = collectStringLeaves(lang.auth);
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(leaf.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every checkout chrome leaf is a non-empty string in every locale', () => {
    for (const lang of Object.values(CATALOGUES)) {
      const leaves = collectStringLeaves(lang.checkout);
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(leaf.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every orderConfirmation chrome leaf is a non-empty string in every locale', () => {
    for (const lang of Object.values(CATALOGUES)) {
      const leaves = collectStringLeaves(lang.orderConfirmation);
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(leaf.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every account chrome leaf is a non-empty string in every locale', () => {
    for (const lang of Object.values(CATALOGUES)) {
      const leaves = collectStringLeaves(lang.account);
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(leaf.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps Arabic script to the Arabic catalogue', () => {
    // A Latin catalogue carrying Arabic means a merge put a string in the
    // wrong file, which is exactly how the ar catalogue was built.
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      if (locale === 'ar') continue;
      for (const leaf of collectStringLeaves(catalogue)) {
        expect(leaf, leaf).not.toMatch(/[؀-ۿ]/);
      }
    }
  });

  it('gives the Arabic catalogue Arabic copy, not a Latin fallback', () => {
    // Placeholders are stripped first: `{count}` is Latin in every language.
    // What is left and still Latin should only be language names in their own
    // script and an example address, which is what the allowlist below is.
    const LATIN_BY_DESIGN = ['English', 'Français', 'name@example.com', 'you@example.com'];
    const offenders = collectStringLeaves(ar)
      .map((leaf) => leaf.replace(/\{[^}]*\}/g, '').trim())
      .filter((leaf) => /[A-Za-z]{4,}/.test(leaf))
      .filter((leaf) => !LATIN_BY_DESIGN.includes(leaf));
    expect(offenders).toEqual([]);
  });

  it('the catalogue is the three locales the build ships', () => {
    // The build catalogue, not one store's locale set: which of these a store
    // serves is runtime config (DR-31).
    expect([...LOCALE_CATALOGUE].sort()).toEqual(['ar', 'en', 'fr']);
    expect(Object.keys(CATALOGUES).sort()).toEqual([...LOCALE_CATALOGUE].sort());
  });

  it('isLocale narrows every catalogue locale and rejects the rest', () => {
    for (const locale of LOCALE_CATALOGUE) {
      expect(isLocale(locale), locale).toBe(true);
    }
    expect(isLocale('de')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('LOCALE_INTL_TAG has one language tag per registry locale', () => {
    expect(Object.keys(LOCALE_INTL_TAG).sort()).toEqual([...LOCALE_CATALOGUE].sort());
    for (const locale of LOCALE_CATALOGUE) {
      const registryTag = getLocaleDefinition(locale)?.intlTag ?? '';
      expect(LOCALE_INTL_TAG[locale], locale).toBe(registryTag.split('-')[0]);
    }
  });

  it('getChromeStrings returns the requested catalogue or the fallback', () => {
    // Shape, not identity: the returned catalogue is the requested one with
    // the store's values filled into its placeholders (plan E2.5), so it is a
    // copy of the source rather than the source object.
    expect(walkKeys(getChromeStrings('fr'))).toEqual(walkKeys(fr));
    expect(walkKeys(getChromeStrings('en'))).toEqual(walkKeys(en));
    expect(walkKeys(getChromeStrings('ar'))).toEqual(walkKeys(ar));
    expect(getChromeStrings('de')).toBe(getChromeStrings('fr'));
    expect(getChromeStrings(null)).toBe(getChromeStrings('fr'));
  });
});

function walkKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    keys.push(...walkKeys(v, prefix ? `${prefix}.${k}` : k));
  }
  return keys.sort();
}

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  const leaves: string[] = [];
  for (const v of Object.values(value as Record<string, unknown>)) {
    leaves.push(...collectStringLeaves(v));
  }
  return leaves;
}
