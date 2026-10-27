import { sanitizeRichTextHtml } from './sanitize';

describe('sanitizeRichTextHtml', () => {
  it('keeps allowed tags', () => {
    const html =
      '<p>Hello <strong>World</strong> <em>now</em></p><h2>Heading</h2><ul><li>One</li></ul>';
    expect(sanitizeRichTextHtml(html)).toBe(html);
  });

  it('strips <script> and inline handlers', () => {
    const out = sanitizeRichTextHtml('<p onclick="x()">hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
  });

  it('rejects javascript: hrefs, keeps https/mailto', () => {
    expect(sanitizeRichTextHtml('<a href="javascript:void(0)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeRichTextHtml('<a href="https://ok.com">ok</a>')).toContain('https://ok.com');
    expect(sanitizeRichTextHtml('<a href="mailto:a@b.co">mail</a>')).toContain('mailto:');
  });

  it('drops unlisted tags entirely (iframe, img)', () => {
    expect(sanitizeRichTextHtml('<iframe src="x"></iframe>')).toBe('');
    expect(sanitizeRichTextHtml('<img src="x.png">')).toBe('');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeRichTextHtml('')).toBe('');
    expect(sanitizeRichTextHtml(null as unknown as string)).toBe('');
  });

  // Lockstep with libs/shared/common/src/utils/sanitize-rich-text.spec.ts. Both
  // configs must canonicalise editor output identically, or the operator sees
  // one thing in the field and the server stores another.
  it('maps b onto strong, i onto em and div onto p', () => {
    expect(sanitizeRichTextHtml('<b>x</b>')).toBe('<strong>x</strong>');
    expect(sanitizeRichTextHtml('<i>x</i>')).toBe('<em>x</em>');
    expect(sanitizeRichTextHtml('<div>a</div><div>b</div>')).toBe('<p>a</p><p>b</p>');
  });

  it('still drops every attribute on a transformed tag', () => {
    expect(sanitizeRichTextHtml('<b onclick="x()">y</b>')).toBe('<strong>y</strong>');
  });

  it('hoists a list out of the heading the editor wrapped around it', () => {
    const out = sanitizeRichTextHtml(
      'Intro.<ul><li>Point un</li></ul><h2><ul><li>Point deux</li></ul></h2>',
    );
    expect(out).toBe('Intro.<ul><li>Point un</li></ul><ul><li>Point deux</li></ul>');
  });

  it('hoists a list out of a paragraph wrapper', () => {
    expect(sanitizeRichTextHtml('<p><ol><li>x</li></ol></p>')).toBe('<ol><li>x</li></ol>');
  });

  it('keeps a heading that wraps its own text', () => {
    expect(sanitizeRichTextHtml('<h2>Title</h2>')).toBe('<h2>Title</h2>');
  });

  it('leaves a list nested inside a list item alone', () => {
    const input = '<ul><li>a<ul><li>b</li></ul></li></ul>';
    expect(sanitizeRichTextHtml(input)).toBe(input);
  });

  it('neutralises the GHSA-9mrh-v2v3-xpfm entity-decoded allow-list bypass', () => {
    const payload = '<noscript>&lt;/noscript&gt;&lt;script&gt;alert(1)&lt;/script&gt;</noscript>';
    const out = sanitizeRichTextHtml(payload);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<\/noscript/i);
  });
});
