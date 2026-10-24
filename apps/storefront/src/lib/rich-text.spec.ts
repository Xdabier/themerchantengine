import { describe, expect, it } from 'vitest';

import { looksLikeRichTextHtml } from './rich-text';

describe('looksLikeRichTextHtml', () => {
  it('recognises the markup the admin editor produces', () => {
    expect(looksLikeRichTextHtml('<p>x</p>')).toBe(true);
    expect(looksLikeRichTextHtml('<strong>x</strong>')).toBe(true);
    expect(looksLikeRichTextHtml('<ul><li>x</li></ul>')).toBe(true);
    expect(looksLikeRichTextHtml('<h2>Titre</h2>')).toBe(true);
    expect(looksLikeRichTextHtml('Texte puis <br /> saut')).toBe(true);
    expect(looksLikeRichTextHtml('<a href="https://x.test">lien</a>')).toBe(true);
  });

  it('leaves legacy plain text alone', () => {
    expect(looksLikeRichTextHtml('Texte simple, sans balise.')).toBe(false);
    expect(looksLikeRichTextHtml('Ligne une.\n\nLigne deux.')).toBe(false);
    expect(looksLikeRichTextHtml('')).toBe(false);
    expect(looksLikeRichTextHtml(null)).toBe(false);
    expect(looksLikeRichTextHtml(undefined)).toBe(false);
  });

  it('does not read a comparison as a tag', () => {
    // The seeded catalogue carries specification prose like this. Treating it as
    // markup would send it through [innerHTML] and lose its line breaks.
    expect(looksLikeRichTextHtml('Prix < 100 LYD')).toBe(false);
    expect(looksLikeRichTextHtml('Couple > 20 Ncm, angle < 30 degres')).toBe(false);
  });
});
