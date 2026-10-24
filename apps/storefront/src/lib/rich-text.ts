/**
 * Tells admin-authored rich text apart from legacy plain text.
 *
 * Two content generations share one field. Anything saved through the admin
 * WYSIWYG is sanitized HTML and has to render through `[innerHTML]`. Everything
 * seeded before that editor existed is plain text whose paragraphs are `\n`
 * breaks, and HTML rendering swallows those, so it needs `white-space:
 * pre-wrap` instead. Neither treatment is right for both.
 *
 * The test is tied to the sanitizer allow-list rather than to a generic
 * `<...>` shape, because product copy legitimately contains comparisons like
 * "angle < 30 degres" and a loose test would send that down the HTML branch
 * and drop its line breaks.
 */
const RICH_TEXT_TAG = /<\/?(?:p|br|strong|em|a|ul|ol|li|h[1-4])(?:\s[^>]*)?\/?>/i;

export function looksLikeRichTextHtml(value: string | null | undefined): boolean {
  return typeof value === 'string' && RICH_TEXT_TAG.test(value);
}
