import { describe, expect, it } from 'vitest';
import { fixSentenceSpacing, fixTranslatableSpacing } from '../../lib/sentence-spacing';

/**
 * Plan H, phase H4. Findings H2 and E9.
 *
 * Gemini enrichment produced product copy with the space after a full stop
 * missing, and the ingest scripts wrote it into the catalogue verbatim. It is
 * live on the storefront: the S-Labo mask reads "...here.At the
 * heart of this mask...".
 *
 * The transform is one regex applied in three places (the ingest scripts, the
 * catalogue JSON on disk, and already-seeded rows), so its shape is the whole
 * design and this is the only place it is pinned. The "leaves alone" block
 * below is not padding: a looser rule breaks decimals, abbreviations, domain
 * names, product codes and prices, all of which appear in this copy.
 */
describe('fixSentenceSpacing', () => {
  it('repairs the two joins the finding cites', () => {
    expect(fixSentenceSpacing('here.At the heart of this mask')).toBe(
      'here. At the heart of this mask',
    );
    expect(fixSentenceSpacing('glycerin base.Using this mask')).toBe(
      'glycerin base. Using this mask',
    );
  });

  it('repairs the rest of the measured class', () => {
    for (const [broken, fixed] of [
      ['deep cleansing.You will', 'deep cleansing. You will'],
      ['the climate.This serum', 'the climate. This serum'],
      ['rich essence.Using it', 'rich essence. Using it'],
      ['stays hydrated.Using this', 'stays hydrated. Using this'],
      ['across Lyon.Each jar', 'across Lyon. Each jar'],
      ['quite distinct.When you', 'quite distinct. When you'],
      ['raw honey.This jar', 'raw honey. This jar'],
      ['its purity.This is', 'its purity. This is'],
    ]) {
      expect(fixSentenceSpacing(broken)).toBe(fixed);
    }
  });

  it('leaves decimals, prices and measurements alone', () => {
    for (const text of ['2.5 kg of honey', '10.50 per jar', 'version 1.2 of the blend']) {
      expect(fixSentenceSpacing(text)).toBe(text);
    }
  });

  it('leaves abbreviations and initialisms alone', () => {
    for (const text of ['e.g. example', 'U.S. imports', 'i.e. raw honey', 'Dr. Ahmed']) {
      expect(fixSentenceSpacing(text)).toBe(text);
    }
  });

  it('leaves product codes and initials alone', () => {
    // These are what actually pin the two-lowercase requirement before the
    // stop. The abbreviation cases above do not: `e.g.` and `U.S.` survive a
    // one-letter head too, because what follows their stop is a space or a
    // lone capital. A brand code is the case that breaks, and this catalogue
    // is full of them.
    for (const text of [
      'model NSK.Pro variant',
      'W.Klein instruments',
      'reference AB.Cd in the box',
    ]) {
      expect(fixSentenceSpacing(text)).toBe(text);
    }
  });

  it('leaves domain names and URLs alone', () => {
    for (const text of [
      'visit the storefront today',
      'https://example.test/products',
      'write to noreply@the storefront',
    ]) {
      expect(fixSentenceSpacing(text)).toBe(text);
    }
  });

  it('leaves a correctly spaced sentence alone', () => {
    const text = 'Harvested. At the heart of this jar is raw sidr honey.';
    expect(fixSentenceSpacing(text)).toBe(text);
  });

  it('leaves non-Latin script alone', () => {
    for (const text of ['العسل الطبيعي.هذا المنتج', 'Miel brut. Récolté au Yémen.']) {
      expect(fixSentenceSpacing(text)).toBe(text);
    }
  });

  it('is idempotent, so it can run on the catalogue, the seed and the database', () => {
    const once = fixSentenceSpacing('in the region.At the heart.Using this mask');
    expect(once).toBe('in the region. At the heart. Using this mask');
    expect(fixSentenceSpacing(once)).toBe(once);
  });

  it('repairs every join in a string, not only the first', () => {
    expect(fixSentenceSpacing('one thing.Another thing.Third thing')).toBe(
      'one thing. Another thing. Third thing',
    );
  });
});

describe('fixTranslatableSpacing', () => {
  it('repairs the en and default keys', () => {
    expect(
      fixTranslatableSpacing({ default: 'the region.At heart', en: 'the region.At heart' }),
    ).toEqual({ default: 'the region. At heart', en: 'the region. At heart' });
  });

  it('leaves every other locale untouched, including fr and ar', () => {
    // The defect is an artifact of the English Gemini enrichment. French and
    // Arabic copy came from a different path and must not be rewritten by a
    // rule that was never validated against them.
    const value = { default: 'a.B', en: 'a.B', fr: 'le.Au coeur', ar: 'الخليج.في' };
    expect(fixTranslatableSpacing(value)).toEqual({
      default: 'a.B',
      en: 'a.B',
      fr: 'le.Au coeur',
      ar: 'الخليج.في',
    });
  });

  it('passes null, undefined and non-objects straight through', () => {
    expect(fixTranslatableSpacing(null)).toBeNull();
    expect(fixTranslatableSpacing(undefined)).toBeUndefined();
    expect(fixTranslatableSpacing('a string')).toBe('a string');
  });

  it('returns the same object reference when nothing changed', () => {
    // The patch script decides whether to issue an UPDATE by identity, so a
    // helper that always allocates would make every row look dirty and rewrite
    // the entire catalogue on every run.
    const value = { default: 'Fine. Already spaced.', en: 'Fine. Already spaced.' };
    expect(fixTranslatableSpacing(value)).toBe(value);
  });
});
