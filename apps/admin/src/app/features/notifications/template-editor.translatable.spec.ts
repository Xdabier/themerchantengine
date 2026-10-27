import { asTranslatable } from './template-editor.page';

/**
 * Regression: seeded notification templates store locale keys with no
 * `default` key. asTranslatable must preserve those locale keys — the prior
 * `'default' in v` guard dropped them, so the editor loaded a blank subject and
 * the live preview rendered empty (server pickLocale has no default fallback).
 * Found in prod verification 2026-06-23. See the Translatable schema-drift class.
 */
describe('asTranslatable (template editor)', () => {
  it('preserves locale-keyed Translatables without a default key', () => {
    const v = { en: 'Weekly performance digest', fr: 'Synthèse hebdomadaire' };
    expect(asTranslatable(v)).toEqual(v);
  });

  it('preserves a Translatable that already has a default', () => {
    const v = { default: 'D', en: 'E', fr: 'F' };
    expect(asTranslatable(v)).toEqual(v);
  });

  it('falls back to a blank Translatable for non-objects', () => {
    expect(asTranslatable(null)).toEqual({ default: '' });
    expect(asTranslatable(undefined)).toEqual({ default: '' });
    expect(asTranslatable('nope')).toEqual({ default: '' });
  });
});
