import sanitizeHtml from 'sanitize-html';

/**
 * Client-side mirror of the backend `sanitizeRichText` (see
 * `libs/shared/common/src/utils/sanitize-rich-text.ts`). We duplicate the
 * config here to avoid pulling Nest into the Angular bundle — the
 * allow-list is trivial to keep in sync and already lives behind two
 * gates (here + server).
 *
 * Allowed: p, br, strong, em, a, ul, ol, li, h1-h4. Strips scripts,
 * inline handlers, javascript: URIs.
 */
export const RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
] as const;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: RICH_TEXT_ALLOWED_TAGS as unknown as string[],
  allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['https', 'http', 'mailto'],
  disallowedTagsMode: 'discard',
  /* Mirror of the server transform. The backend file carries the why. */
  transformTags: { b: 'strong', i: 'em', div: 'p' },
};

/**
 * Wrappers the editor illegally puts a block inside. `formatBlock('H2')` with
 * the caret in a list item wraps the WHOLE list, so
 * `<h2><ul><li>..</li></ul></h2>` reaches this function. `sanitize-html` does
 * no structural validation, so without the pass below that markup is stored
 * and shipped verbatim.
 */
const BLOCK_WRAPPER_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4']);

/** Block tags that may never sit inside one of the wrappers above. */
const NESTED_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol']);

/** The one void element in the allowlist. */
const VOID_TAGS = new Set(['br']);

const TAG_PATTERN = /<(\/?)([a-z][a-z0-9]*)(?:"[^"]*"|'[^']*'|[^>])*>/gi;

type RichTextNode =
  | { kind: 'text'; html: string }
  | { kind: 'element'; tag: string; open: string; children: RichTextNode[] };

/**
 * Parses the sanitizer's own output. Safe to hand-roll because the input is
 * already reduced to the allowlist: no comments, no CDATA, no unquoted
 * attribute values, one void element.
 */
function parseRichTextNodes(html: string): RichTextNode[] {
  const root: RichTextNode[] = [];
  const open: { tag: string; open: string; children: RichTextNode[] }[] = [];
  const target = (): RichTextNode[] => (open.length ? open[open.length - 1].children : root);
  const closeTop = (): void => {
    const top = open.pop();
    if (!top) return;
    (open.length ? open[open.length - 1].children : root).push({
      kind: 'element',
      tag: top.tag,
      open: top.open,
      children: top.children,
    });
  };

  const pattern = new RegExp(TAG_PATTERN.source, 'gi');
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match.index > cursor)
      target().push({ kind: 'text', html: html.slice(cursor, match.index) });
    cursor = pattern.lastIndex;
    const tag = match[2].toLowerCase();
    if (match[1]) {
      const depth = open.map((entry) => entry.tag).lastIndexOf(tag);
      if (depth >= 0) while (open.length > depth) closeTop();
      continue;
    }
    if (VOID_TAGS.has(tag)) {
      target().push({ kind: 'text', html: match[0] });
      continue;
    }
    open.push({ tag, open: match[0], children: [] });
  }
  if (cursor < html.length) target().push({ kind: 'text', html: html.slice(cursor) });
  while (open.length) closeTop();
  return root;
}

function hasRenderedContent(node: RichTextNode): boolean {
  return node.kind === 'element' || node.html.trim().length > 0;
}

/**
 * Hoists a block out of the paragraph or heading that wrapped it, keeping any
 * inline text the wrapper also held. `<h2>Title<ul>..</ul></h2>` becomes
 * `<h2>Title</h2><ul>..</ul>`; an emptied wrapper is dropped. A list inside a
 * list item is legal and left alone.
 */
function hoistNestedBlocks(nodes: RichTextNode[]): RichTextNode[] {
  const out: RichTextNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'text') {
      out.push(node);
      continue;
    }
    const children = hoistNestedBlocks(node.children);
    const isWrapper = BLOCK_WRAPPER_TAGS.has(node.tag);
    if (isWrapper && !children.some(hasRenderedContent)) {
      // htmlparser2 applies the HTML5 rule that a block closes an open <p>, so
      // `<p><ol>..</ol></p>` reaches us as `<p></p><ol>..</ol><p></p>`. An empty
      // wrapper renders nothing; drop it rather than ship a stray blank line.
      continue;
    }
    const carriesBlock = children.some(
      (child) => child.kind === 'element' && NESTED_BLOCK_TAGS.has(child.tag),
    );
    if (!isWrapper || !carriesBlock) {
      out.push({ kind: 'element', tag: node.tag, open: node.open, children });
      continue;
    }
    let run: RichTextNode[] = [];
    const flushRun = (): void => {
      if (run.some(hasRenderedContent)) {
        out.push({ kind: 'element', tag: node.tag, open: node.open, children: run });
      }
      run = [];
    };
    for (const child of children) {
      if (child.kind === 'element' && NESTED_BLOCK_TAGS.has(child.tag)) {
        flushRun();
        out.push(child);
      } else {
        run.push(child);
      }
    }
    flushRun();
  }
  return out;
}

function serializeRichTextNodes(nodes: RichTextNode[]): string {
  let html = '';
  for (const node of nodes) {
    html +=
      node.kind === 'text'
        ? node.html
        : `${node.open}${serializeRichTextNodes(node.children)}</${node.tag}>`;
  }
  return html;
}

/** Post-pass over sanitizer output: canonical block structure, same allowlist. */
function normalizeBlockStructure(html: string): string {
  if (!/<(?:p|h[1-4])\b/i.test(html)) return html;
  return serializeRichTextNodes(hoistNestedBlocks(parseRichTextNodes(html)));
}

/** Returns the sanitized HTML string. Never throws on invalid input. */
export function sanitizeRichTextHtml(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return normalizeBlockStructure(sanitizeHtml(input, OPTIONS));
}
