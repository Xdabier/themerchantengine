import { ogLocaleFromLocale, regionFromLocale } from './locale-region';

describe('locale-region', () => {
  it('appends the store country as the region tail', () => {
    expect(regionFromLocale('fr', 'LY')).toBe('fr-LY');
    expect(regionFromLocale('ar', 'AE')).toBe('ar-AE');
    expect(regionFromLocale('en', 'ae')).toBe('en-AE');
  });

  it('emits the bare language tag when the store has no country yet', () => {
    expect(regionFromLocale('fr', '')).toBe('fr');
    expect(regionFromLocale('fr', null)).toBe('fr');
    expect(regionFromLocale('fr', undefined)).toBe('fr');
  });

  it('refuses a tail that is not an ISO 3166-1 alpha-2 code', () => {
    // A stray value in the settings row must not become a malformed hreflang.
    expect(regionFromLocale('fr', 'Libya')).toBe('fr');
    expect(regionFromLocale('fr', 'L')).toBe('fr');
  });

  it('never bakes a country in: the same locale follows the config', () => {
    expect(regionFromLocale('fr', 'LY')).not.toBe(regionFromLocale('fr', 'MA'));
  });

  it('never stacks a second region on a tag that already has one', () => {
    expect(regionFromLocale('fr-FR', 'LY')).toBe('fr-LY');
    expect(regionFromLocale('ar-QA', 'AE')).toBe('ar-AE');
    expect(regionFromLocale('fr-FR', null)).toBe('fr');
    expect(ogLocaleFromLocale('ar-QA', 'AE')).toBe('ar_AE');
  });

  it('writes the Open Graph underscore form', () => {
    expect(ogLocaleFromLocale('fr', 'LY')).toBe('fr_LY');
    expect(ogLocaleFromLocale('en', null)).toBe('en');
  });
});
