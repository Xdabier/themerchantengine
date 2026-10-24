import { specKey } from '@common/utils';
import { specKey as seedSpecKey } from '../../../prisma/spec-key';

/**
 * The prod runtime image copies `prisma/` but not `libs/` (apps/api/Dockerfile),
 * so `prisma/seed.ts` cannot import `@common/*`. It carries a hand-maintained
 * copy instead. This spec is the guard that keeps the copy honest: edit one file
 * without the other and `npx nx test api` goes red.
 *
 * Modelled on `permission-catalogue.parity.spec.ts`, which guards the same
 * constraint for the permission catalogue.
 *
 * The two folds MUST agree exactly. `ProductSpec.key` is the uniqueness key
 * behind `@@unique([productId, key])` and the grouping key behind the spec
 * facets, so a disagreement writes the same label under two keys: seeded rows
 * and admin-written rows would stop matching, and one specification would
 * appear as two filters on the storefront.
 */
const CORPUS = [
  // The case the whole fold exists for.
  'Matériau',
  'Materiau',
  'MATÉRIAU',
  // Other accents and ligature-ish forms across the fr + en pair.
  'Coloris présélectionné',
  'Diamètre',
  'Ångström',
  'naïve façade',
  // Separator handling.
  'Type de brosse',
  'Type  de   brosse',
  'Type-de-brosse',
  'Type_de_brosse',
  '  leading and trailing  ',
  '---dashes---',
  // Punctuation and symbols that are not alphanumeric.
  'Longueur (mm)',
  'Poids: 12,5 g',
  'A/B test',
  '100% coton',
  // Digits survive.
  'ISO 9001',
  // Degenerate input.
  '',
  '   ',
  '---',
  'é',
  '!!!',
  // Over the 120-character cap.
  'a'.repeat(200),
  `${'Matériau '.repeat(40)}`,
  /**
   * COMPATIBILITY characters, and the reason this list is not just accented
   * letters. NFD and NFKD agree on every plain accented Latin letter, so a
   * corpus of "Matériau"-style inputs cannot tell the two apart: swapping NFKD
   * for NFD in one copy leaves such a corpus fully green, which is a guard
   * unable to fail. These four are where the two normalisations diverge, and
   * each is a plausible thing to type into a dental-supply specification.
   */
  'Longueur mm²', // superscript two: NFKD keeps the digit, NFD drops it
  'ﬁche technique', // fi ligature: NFKD splits it, NFD strips the whole glyph
  '½ pouce', // vulgar fraction: NFKD expands to 1/2, NFD drops it
  'Ⅻ', // roman numeral twelve: NFKD expands to XII, NFD drops it
];

describe('prisma/spec-key parity with @common/utils specKey', () => {
  it.each(CORPUS)('folds %j identically in both copies', (input) => {
    expect(seedSpecKey(input)).toBe(specKey(input));
  });

  it('agrees on a null-ish input, which the seed can hand it', () => {
    expect(seedSpecKey(undefined as unknown as string)).toBe(
      specKey(undefined as unknown as string),
    );
    expect(seedSpecKey(null as unknown as string)).toBe(specKey(null as unknown as string));
  });
});

/**
 * Behaviour of the fold itself, asserted on the library copy. These are the
 * promises the schema comment on `ProductSpec.key` makes, so they are pinned
 * rather than left implicit.
 */
describe('specKey', () => {
  it('folds an accented label onto its unaccented spelling', () => {
    expect(specKey('Matériau')).toBe('materiau');
    expect(specKey('Materiau')).toBe('materiau');
  });

  it('is case insensitive', () => {
    expect(specKey('MATÉRIAU')).toBe(specKey('matériau'));
  });

  it('collapses every run of non-alphanumerics to a single hyphen', () => {
    expect(specKey('Type  de   brosse')).toBe('type-de-brosse');
    expect(specKey('Type_de_brosse')).toBe('type-de-brosse');
    expect(specKey('Poids: 12,5 g')).toBe('poids-12-5-g');
  });

  it('trims leading and trailing hyphens', () => {
    expect(specKey('  leading and trailing  ')).toBe('leading-and-trailing');
    expect(specKey('---dashes---')).toBe('dashes');
  });

  it('keeps digits', () => {
    expect(specKey('ISO 9001')).toBe('iso-9001');
  });

  it('caps at 120 characters, the indexed column bound', () => {
    expect(specKey('a'.repeat(200))).toHaveLength(120);
  });

  /**
   * NFKD, not NFD, and these are the cases that prove which one is in force.
   * Both normalisations handle plain accented letters identically, so only a
   * compatibility character can tell them apart. Written as explicit
   * expectations so a future edit to NFD fails here with a readable diff rather
   * than only inside the parity loop.
   */
  it('expands compatibility characters, which NFD would drop', () => {
    expect(specKey('Longueur mm²')).toBe('longueur-mm2');
    expect(specKey('ﬁche technique')).toBe('fiche-technique');
    expect(specKey('½ pouce')).toBe('1-2-pouce');
    expect(specKey('Ⅻ')).toBe('xii');
  });

  it('returns an empty string for input with nothing alphanumeric in it', () => {
    expect(specKey('')).toBe('');
    expect(specKey('   ')).toBe('');
    expect(specKey('!!!')).toBe('');
  });

  /**
   * The reason this function exists rather than reusing `toSlug` from the
   * products service: that one normalises with NFD and strips a different
   * character class, so the two disagree on exactly the inputs this fold was
   * written for.
   */
  it('is not interchangeable with the products-service toSlug', () => {
    const toSlug = (text: string): string =>
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    // `toSlug` keeps the underscore (it is a `\w`), this fold does not.
    expect(toSlug('Type_de_brosse')).not.toBe(specKey('Type_de_brosse'));
    // `toSlug` applies no length cap.
    expect(toSlug('a'.repeat(200))).not.toBe(specKey('a'.repeat(200)));
  });
});
