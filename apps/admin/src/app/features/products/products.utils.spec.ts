import {
  looksLikeRichTextHtml,
  pickTranslatable,
  productStatusTone,
  qualityTone,
} from './products.utils';

describe('products.utils', () => {
  describe('productStatusTone', () => {
    it('maps the three enum values to branded tones', () => {
      expect(productStatusTone('ACTIVE')).toBe('success');
      expect(productStatusTone('DRAFT')).toBe('warning');
      expect(productStatusTone('ARCHIVED')).toBe('error');
    });
    it('falls back to neutral for unknowns', () => {
      expect(productStatusTone('ZZ')).toBe('neutral');
    });
  });

  describe('qualityTone', () => {
    it('maps the score buckets', () => {
      expect(qualityTone('green')).toBe('success');
      expect(qualityTone('yellow')).toBe('warning');
      expect(qualityTone('amber')).toBe('warning');
      expect(qualityTone('red')).toBe('error');
      expect(qualityTone(undefined)).toBe('neutral');
    });
  });

  describe('pickTranslatable', () => {
    it('returns the requested locale when present', () => {
      const value = { fr: 'Bonjour', en: 'Hello', default: 'Bonjour' };
      expect(pickTranslatable(value, 'fr', 'xx')).toBe('Bonjour');
      expect(pickTranslatable(value, 'en', 'xx')).toBe('Hello');
    });
    it('falls back to default', () => {
      expect(pickTranslatable({ en: 'Hello', default: 'H' }, 'fr', 'xx')).toBe('H');
      expect(pickTranslatable({ default: 'H' }, 'fr', 'xx')).toBe('H');
    });
    it('passes plain strings through', () => {
      expect(pickTranslatable('Hello', 'fr', 'xx')).toBe('Hello');
    });
    it('returns em-dash for nullish', () => {
      expect(pickTranslatable(null, 'fr', 'xx')).toBe('—');
      expect(pickTranslatable(undefined, 'fr', 'xx')).toBe('—');
    });
    it('finds any populated locale when the usual keys are missing', () => {
      expect(pickTranslatable({ de: 'Hallo' }, 'fr', 'xx')).toBe('Hallo');
    });
  });
});

describe('looksLikeRichTextHtml', () => {
  // The read view has to tell the two content generations apart: anything
  // authored in the WYSIWYG is HTML, anything seeded before it is plain text
  // whose paragraphs are \n breaks.
  it('recognises the markup the editor produces', () => {
    expect(looksLikeRichTextHtml('<p>x</p>')).toBe(true);
    expect(looksLikeRichTextHtml('<ul><li>x</li></ul>')).toBe(true);
    expect(looksLikeRichTextHtml('<strong>x</strong>')).toBe(true);
  });

  it('leaves plain text alone, comparisons included', () => {
    expect(looksLikeRichTextHtml('Texte simple.')).toBe(false);
    expect(looksLikeRichTextHtml('Ligne une.\n\nLigne deux.')).toBe(false);
    expect(looksLikeRichTextHtml('angle < 30 degres')).toBe(false);
    expect(looksLikeRichTextHtml(null)).toBe(false);
  });
});
