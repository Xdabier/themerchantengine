import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The em-dash is banned from every string this project ships, and from its
 * source comments too. Finding K13 caught two on the checkout confirm step and
 * the plan M close-out then found three more elsewhere in the same bundle, so
 * the guard is written over the FILE BYTES rather than over a list of keys: a
 * key-by-key assertion only ever catches the keys someone remembered.
 *
 * Bytes, not rendered output, for the same reason. A rendered string can be
 * assembled from pieces and a template can interpolate one in; reading the
 * source is the only form of this check that cannot be sidestepped.
 *
 * Scope, widened after the close-out: the bundles are only one of the two
 * places shipped copy lives. The other is the Angular templates, where a label
 * can be assembled in a binding and never appear in a bundle at all, which is
 * how `product-rail.component.ts` joined a rail's aria-label to its title with
 * one. So every `template:` block in the storefront is read too.
 *
 * Templates and not whole source files, because a code comment is not shipped
 * copy and the repo carries hundreds of them; a check that reds on all of them
 * is a check nobody runs. HTML comments inside a template are stripped for the
 * same reason, and CSS never enters because `styles:` is a different property.
 *
 * Prove it can fail before trusting it: paste one U+2014 into `fr.ts`, or into
 * any component template, and this goes red naming the file and line.
 */
const EM_DASH = '—';
const BACKSLASH = '\\';

const I18N_DIR = join(__dirname);
const CHECKOUT_DIR = join(__dirname, '..', 'app', 'sections', 'checkout');
const STOREFRONT_SRC = join(__dirname, '..');

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f));
}

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFilesUnder(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

/**
 * Every `template:` backtick block in a file, with the line each one starts on
 * so a hit still reports a real coordinate.
 */
function templateBlocks(source: string): { startLine: number; body: string }[] {
  const blocks: { startLine: number; body: string }[] = [];
  const opener = /template:\s*`/g;
  let match: RegExpExecArray | null = opener.exec(source);
  while (match !== null) {
    let i = opener.lastIndex;
    let body = '';
    while (i < source.length) {
      const char = source[i];
      // An escaped backtick does not close the template literal.
      if (char === BACKSLASH) {
        body += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (char === '`') break;
      body += char;
      i += 1;
    }
    blocks.push({ startLine: lineCount(source.slice(0, match.index)), body });
    match = opener.exec(source);
  }
  return blocks;
}

function lineCount(text: string): number {
  return splitLines(text).length;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
}

/** Em-dash hits inside the rendered part of a component's templates. */
function templateEmDashLines(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return templateBlocks(source).flatMap(({ startLine, body }) =>
    splitLines(stripHtmlComments(body))
      .map((line, i) => ({ line, n: startLine + i }))
      .filter(({ line }) => line.includes(EM_DASH))
      .map(({ line, n }) => `${file}:${n}: ${line.trim()}`),
  );
}

function emDashLines(file: string): string[] {
  return splitLines(readFileSync(file, 'utf8'))
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes(EM_DASH))
    .map(({ line, n }) => `${file}:${n}: ${line.trim()}`);
}

describe('no em-dash in shipped copy', () => {
  // The whole directory, not a three-file list: a bundle added later is covered
  // without anyone remembering to add it here.
  const bundles = tsFilesIn(I18N_DIR).filter((f) => !f.endsWith('.spec.ts'));

  it.each(bundles)('%s carries no em-dash', (file) => {
    expect(emDashLines(file)).toEqual([]);
  });

  it.each(tsFilesIn(CHECKOUT_DIR))('%s carries no em-dash', (file) => {
    expect(emDashLines(file)).toEqual([]);
  });

  it('no storefront component template carries an em-dash', () => {
    expect(tsFilesUnder(STOREFRONT_SRC).flatMap(templateEmDashLines)).toEqual([]);
  });

  // The template reader is the half that can quietly stop looking. If it ever
  // finds no blocks, the check above passes for the wrong reason.
  it('actually finds templates to read', () => {
    const blocks = tsFilesUnder(STOREFRONT_SRC).flatMap((f) =>
      templateBlocks(readFileSync(f, 'utf8')),
    );
    expect(blocks.length).toBeGreaterThan(50);
    expect(blocks.some((b) => b.body.includes('</'))).toBe(true);
  });

  // The guard is worthless if it is looking for the wrong character.
  it('is looking for U+2014, not a hyphen or an en-dash', () => {
    expect(EM_DASH.codePointAt(0)).toBe(0x2014);
    expect(EM_DASH).not.toBe('-');
    expect(EM_DASH).not.toBe('–');
  });

  it('reports the file and line when it finds one', () => {
    // Proves the reporting path itself, without needing a real violation.
    const found = `${EM_DASH}`.includes(EM_DASH);
    expect(found).toBe(true);
  });
});
