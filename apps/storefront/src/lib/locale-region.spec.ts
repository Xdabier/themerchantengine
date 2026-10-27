import { describe, expect, it } from 'vitest';

import {
  fixtureRuntimeConfig,
  STORE_CONFIG_FIXTURE_IDS,
} from '../test-support/store-config-fixtures';
import {
  localeOgTags,
  ogLocaleAlternates,
  ogLocaleFromLocale,
  regionFromLocale,
  type RegionSource,
} from './locale-region';

/**
 * The region tail names the market a store sells in, so it comes from the
 * store's configured country and from nothing else.
 *
 * The previous generation of this file enumerated a literal pair with one
 * client's country baked into both tags, and its own comment said so. What
 * that made possible is the defect asserted against below: the storefront and
 * the API deriving different region tails for one store, which advertises two
 * markets for the same page.
 */

const source = (country: string): RegionSource => ({ country });

describe('regionFromLocale', () => {
  it('qualifies the locale with the configured country', () => {
    expect(regionFromLocale('fr', source('LY'))).toBe('fr-LY');
    expect(regionFromLocale('en', source('LY'))).toBe('en-LY');
    expect(regionFromLocale('ar', source('AE'))).toBe('ar-AE');
  });

  it('uppercases the country, since BCP-47 wants the region uppercase', () => {
    expect(regionFromLocale('fr', source('ly'))).toBe('fr-LY');
    expect(regionFromLocale('fr', source(' ly '))).toBe('fr-LY');
  });

  it('advertises the bare language when the store has named no country', () => {
    // Correct rather than convenient: inventing a region for a store that has
    // not said where it sells would advertise a market it does not serve.
    expect(regionFromLocale('fr', source(''))).toBe('fr');
    expect(regionFromLocale('ar', source('   '))).toBe('ar');
  });
});

describe('ogLocaleFromLocale', () => {
  it('uses the underscore separator the OG spec mandates', () => {
    expect(ogLocaleFromLocale('fr', source('LY'))).toBe('fr_LY');
    expect(ogLocaleFromLocale('ar', source('AE'))).toBe('ar_AE');
  });

  it('emits the bare language with no separator when there is no country', () => {
    expect(ogLocaleFromLocale('en', source(''))).toBe('en');
  });
});

describe('ogLocaleAlternates', () => {
  it('lists every other locale the store serves, never the page own', () => {
    expect(ogLocaleAlternates('fr', ['fr', 'en'], source('LY'))).toEqual(['en_LY']);
    expect(ogLocaleAlternates('en', ['fr', 'en', 'ar'], source('AE'))).toEqual(['fr_AE', 'ar_AE']);
  });

  it('is empty for a single-locale store', () => {
    expect(ogLocaleAlternates('ar', ['ar'], source('AE'))).toEqual([]);
  });

  it('never advertises a catalogue locale the store does not serve', () => {
    // The build ships three catalogues; a store that enabled two must not
    // advertise the third as an equivalent variant of its pages.
    expect(ogLocaleAlternates('fr', ['fr', 'en'], source('LY'))).not.toContain('ar_LY');
  });
});

describe('localeOgTags', () => {
  it('maps every configured locale to its OG form', () => {
    expect(localeOgTags(['fr', 'ar'], source('LY'))).toEqual({ fr: 'fr_LY', ar: 'ar_LY' });
  });
});

describe('under the scenario fixtures', () => {
  it.each(STORE_CONFIG_FIXTURE_IDS)('%s derives its tail from its own country', (id) => {
    const config = fixtureRuntimeConfig(id);
    const country = config.identity.address.country;
    for (const locale of config.localization.supportedLocales) {
      expect(regionFromLocale(locale, { country })).toBe(`${locale}-${country.toUpperCase()}`);
    }
  });

  it('gives two fixtures with different countries different tails', () => {
    const gulf = fixtureRuntimeConfig('gulf-rtl');
    const maghreb = fixtureRuntimeConfig('maghreb-ltr');
    expect(gulf.identity.address.country).not.toBe(maghreb.identity.address.country);
    expect(regionFromLocale('en', { country: gulf.identity.address.country })).not.toBe(
      regionFromLocale('en', { country: maghreb.identity.address.country }),
    );
  });
});
