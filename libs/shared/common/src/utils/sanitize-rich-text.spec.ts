import {
  sanitizeRichText,
  sanitizeTranslatableHtml,
  sanitizeEmailHtml,
  sanitizeTranslatableEmailHtml,
} from './sanitize-rich-text';

describe('sanitizeRichText (CMS allowlist)', () => {
  it('keeps the allowed rich-text tags', () => {
    const input = '<p>Hello <strong>world</strong> <a href="https://x.test">link</a></p>';
    expect(sanitizeRichText(input)).toBe(input);
  });

  it('strips <script> and its content', () => {
    expect(sanitizeRichText('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>');
  });

  it('drops a style attribute and maps the div onto the allowed paragraph', () => {
    // Was 'x'. The editor emits <div> blocks on Enter, so a discarded <div>
    // silently merged two authored lines into one run of text. The transform
    // keeps the block, the style attribute is still dropped.
    expect(sanitizeRichText('<div style="color:red">x</div>')).toBe('<p>x</p>');
  });
});

describe('sanitizeRichText (editor output canonicalisation)', () => {
  it('maps b onto strong and i onto em', () => {
    expect(sanitizeRichText('<b>x</b>')).toBe('<strong>x</strong>');
    expect(sanitizeRichText('<i>x</i>')).toBe('<em>x</em>');
  });

  it('maps div line blocks onto paragraphs', () => {
    expect(sanitizeRichText('<div>a</div><div>b</div>')).toBe('<p>a</p><p>b</p>');
  });

  it('still drops every attribute on a transformed tag', () => {
    expect(sanitizeRichText('<b onclick="x()">y</b>')).toBe('<strong>y</strong>');
  });

  it('hoists a list out of the heading the editor wrapped around it', () => {
    // The exact value /qa-page-2026 stored: formatBlock('H2') with the caret in
    // a list item wraps the whole list, and sanitize-html does no structural
    // validation, so <h2><ul> shipped to the storefront verbatim.
    const out = sanitizeRichText(
      'Intro.<ul><li>Point un</li></ul><h2><ul><li>Point deux</li></ul></h2>',
    );
    expect(out).not.toContain('<h2>');
    expect(out).toBe('Intro.<ul><li>Point un</li></ul><ul><li>Point deux</li></ul>');
  });

  it('hoists a list out of a paragraph wrapper', () => {
    expect(sanitizeRichText('<p><ol><li>x</li></ol></p>')).toBe('<ol><li>x</li></ol>');
  });

  it('keeps the heading when it wraps its own text', () => {
    expect(sanitizeRichText('<h2>Title</h2><p>Body</p>')).toBe('<h2>Title</h2><p>Body</p>');
  });

  it('splits a heading that carries text before a hoisted list', () => {
    expect(sanitizeRichText('<h2>Title<ul><li>x</li></ul></h2>')).toBe(
      '<h2>Title</h2><ul><li>x</li></ul>',
    );
  });

  it('leaves a list nested inside a list item alone', () => {
    const input = '<ul><li>a<ul><li>b</li></ul></li></ul>';
    expect(sanitizeRichText(input)).toBe(input);
  });

  it('leaves the email allowlist untouched', () => {
    expect(sanitizeEmailHtml('<b>x</b>')).toBe('<b>x</b>');
    expect(sanitizeEmailHtml('<div>a</div><div>b</div>')).toBe('<div>a</div><div>b</div>');
    expect(sanitizeEmailHtml('<i>x</i>')).toBe('<i>x</i>');
  });
});

describe('sanitizeEmailHtml (email allowlist)', () => {
  it('keeps the table-based, inline-CSS layout markup intact', () => {
    // sanitize-html parses and re-serialises inline CSS (it strips the trailing
    // `;`), so assert the structure survives rather than byte equality.
    const input =
      '<div style="margin:24px 0;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">' +
      '<tr><td style="padding:6px 0;">From</td><td style="padding:6px 0;">Sam</td></tr>' +
      '</table>' +
      '<a href="https://example.test/o/1" style="display:inline-block;background:#0B0B0B;">View order</a>' +
      '</div>';
    const out = sanitizeEmailHtml(input);
    expect(out).toContain('<table role="presentation" cellpadding="0" cellspacing="0"');
    expect(out).toContain('<td style="padding:6px 0');
    expect(out).toContain('<a href="https://example.test/o/1"');
    expect(out).toContain('background:#0B0B0B');
    expect(out).toContain('View order');
  });

  it('keeps the inline style attribute (CSS re-serialised, trailing ; dropped)', () => {
    expect(sanitizeEmailHtml('<td style="color:#6B6B6B;padding:6px 0;">x</td>')).toBe(
      '<td style="color:#6B6B6B;padding:6px 0">x</td>',
    );
  });

  it('keeps the href on a CTA <a>', () => {
    expect(sanitizeEmailHtml('<a href="https://x.test/path">go</a>')).toBe(
      '<a href="https://x.test/path">go</a>',
    );
  });

  it('strips a <script> tag and its content entirely', () => {
    expect(sanitizeEmailHtml('<p>hi</p><script>steal()</script>')).toBe('<p>hi</p>');
  });

  it('strips a <style> block (not in the email allowlist)', () => {
    expect(sanitizeEmailHtml('<style>.x{color:red}</style><p>hi</p>')).toBe('<p>hi</p>');
  });

  it('strips an on* event-handler attribute but keeps the element', () => {
    expect(sanitizeEmailHtml('<p onclick="x()">hi</p>')).toBe('<p>hi</p>');
    expect(sanitizeEmailHtml('<img src="https://x.test/a.png" onerror="x()">')).toBe(
      '<img src="https://x.test/a.png" />',
    );
  });

  it('strips a javascript: href (scheme not allowed) but keeps the anchor', () => {
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('strips a data: URI on an img', () => {
    expect(sanitizeEmailHtml('<img src="data:image/png;base64,AAA">')).toBe('<img />');
  });

  it('preserves {{token}} / {{{token}}} placeholders, including inside an href', () => {
    const input = '<a href="{{{actionUrl}}}" style="color:#0A6B6E;">{{actionUrl}}</a>';
    const out = sanitizeEmailHtml(input);
    expect(out).toContain('href="{{{actionUrl}}}"');
    expect(out).toContain('{{actionUrl}}');
  });

  it('keeps a mailto: href', () => {
    expect(sanitizeEmailHtml('<a href="mailto:x@y.test">mail</a>')).toBe(
      '<a href="mailto:x@y.test">mail</a>',
    );
  });
});

describe('sanitizeTranslatableEmailHtml', () => {
  it('sanitizes each locale value with the email allowlist and drops non-strings', () => {
    const out = sanitizeTranslatableEmailHtml({
      en: '<div style="color:red">ok</div><script>bad()</script>',
      fr: '<p onclick="x()">Bonjour</p>',
      // @ts-expect-error — exercise the non-string drop branch
      meta: 5,
    });
    expect(out.en).toBe('<div style="color:red">ok</div>');
    expect(out.fr).toBe('<p>Bonjour</p>');
    expect(out.meta).toBeUndefined();
  });
});

describe('sanitizeTranslatableHtml', () => {
  it('sanitizes each locale value and drops non-strings', () => {
    const out = sanitizeTranslatableHtml({
      en: '<p>ok</p><script>x()</script>',
      // @ts-expect-error — exercise the non-string drop branch
      n: 1,
    });
    expect(out.en).toBe('<p>ok</p>');
    expect(out.n).toBeUndefined();
  });
});
