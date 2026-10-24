import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist of safe HTML tags for rich text fields (§8.3, §8.6).
 * Strips <script>, onclick, javascript: URIs, and all other unsafe content.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4'],
  allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['https', 'http', 'mailto'],
  disallowedTagsMode: 'discard',
  /*
   * The admin editor drives `document.execCommand`, which emits `<b>`, `<i>`
   * and (on Enter) `<div>` line blocks. None of those are on the allowlist,
   * and `disallowedTagsMode: 'discard'` keeps the text but drops the tag, so
   * bold, italic and paragraph structure vanished on save while the field
   * still showed them. sanitize-html applies the mapping before allowlist
   * filtering, so the authored intent survives as the canonical tag.
   */
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

/**
 * Sanitizes a single string of rich text HTML.
 */
export function sanitizeRichText(input: string): string {
  return normalizeBlockStructure(sanitizeHtml(input, SANITIZE_OPTIONS));
}

/**
 * Sanitizes every locale value in a Translatable rich text object.
 * Non-string values are dropped.
 */
export function sanitizeTranslatableHtml(obj: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeRichText(value);
    }
  }
  return result;
}

/**
 * Allowlist for transactional-email bodies (§3.5).
 *
 * Email bodies are table-based, inline-CSS HTML — the layout header/footer plus
 * per-flow content built from `<div>`/`<table>` blocks and styled `<a>` CTA
 * buttons. The rich-text allowlist above (no `style`, no `div`/`span`/`table`)
 * would strip the brand layout to rubble, so email bodies get their own,
 * wider allowlist that PRESERVES the layout markup while still removing every
 * script vector: `<script>`/`<style>` blocks are discarded, all `on*` event
 * handlers are dropped (only the attributes below survive), and only
 * http(s)/mailto URL schemes are allowed (so `javascript:` / `data:` hrefs are
 * stripped). Inline `style` is permitted because email clients require it for
 * any styling at all; the operators who reach this path hold `notifications:*`
 * RBAC, so the threat model is a defence-in-depth save-time scrub, not
 * untrusted public input.
 */
const EMAIL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'div',
    'span',
    'small',
    'code',
    'pre',
    'blockquote',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'img',
  ],
  allowedAttributes: {
    '*': ['style', 'dir', 'align'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    table: ['role', 'cellpadding', 'cellspacing', 'width', 'border'],
    td: ['width', 'colspan', 'rowspan', 'valign', 'align'],
    th: ['width', 'colspan', 'rowspan', 'valign', 'align'],
  },
  // `mailto`/http(s) only — drops `javascript:` and `data:` URIs on hrefs.
  allowedSchemes: ['https', 'http', 'mailto'],
  // `img` may not carry a `data:` payload either.
  allowedSchemesByTag: { img: ['https', 'http'] },
  disallowedTagsMode: 'discard',
};

/**
 * Sanitizes a single transactional-email HTML body. Preserves the inline-CSS,
 * table-based layout while stripping `<script>`/`<style>`, `on*` handlers, and
 * `javascript:`/`data:` URIs. `{{token}}` / `{{{token}}}` placeholders pass
 * through untouched (they are scheme-less relative text, not stripped).
 */
export function sanitizeEmailHtml(input: string): string {
  return sanitizeHtml(input, EMAIL_SANITIZE_OPTIONS);
}

/**
 * Sanitizes every locale value in a Translatable email-body object with the
 * email allowlist. Non-string values are dropped.
 */
export function sanitizeTranslatableEmailHtml(obj: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeEmailHtml(value);
    }
  }
  return result;
}
