import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = join(__dirname);

/**
 * Call sites that legitimately do not route through `pageTitle`, each with the
 * reason. Anything else that calls `Title.setTitle` directly fails this spec.
 */
const ALLOWED = new Map<string, string>([
  [
    'title-strategy.ts',
    'composes the suffix itself from meta.title, for routes that declare a title',
  ],
  ['pages/404.page.ts', 'locale-less error shell, no i18n strings available'],
  ['pages/500.page.ts', 'locale-less error shell, no i18n strings available'],
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function relative(path: string): string {
  return path.slice(APP_DIR.length + 1).replace(/\\/g, '/');
}

/** The full parenthesised call starting at `open`, paren-balanced. */
function readCall(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/**
 * Finding A5. Every page called `Title.setTitle` with a full i18n string, so
 * the trailing store suffix was a copywriting convention rather than a rule:
 * the returns and cart pages, whose strings forgot it, shipped a bare heading
 * as their tab title.
 *
 * Asserted over the SOURCE rather than over rendered output, because a
 * rendered assertion only covers the pages a test happens to visit and the two
 * that regressed were exactly the ones nothing visited.
 */
describe('page title suffix (finding A5)', () => {
  const files = walk(APP_DIR);

  it('finds the source tree it is meant to guard', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('routes every setTitle call through pageTitle', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (ALLOWED.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      // Read to the balanced closing paren rather than to the end of the line:
      // prettier wraps the longer calls across several lines, and a
      // line-scoped pattern reads those as bypasses.
      for (const match of source.matchAll(/setTitle\(/g)) {
        const call = readCall(source, (match.index ?? 0) + match[0].length - 1);
        if (!call.includes('pageTitle(')) {
          offenders.push(`${rel}: setTitle${call.replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(offenders, `setTitle without pageTitle:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps the allowlist honest — every entry still exists and still sets a title', () => {
    for (const [rel] of ALLOWED) {
      const source = readFileSync(join(APP_DIR, rel), 'utf8');
      expect(source, `${rel} no longer sets a title; drop it from the allowlist`).toContain(
        'setTitle(',
      );
    }
  });
});
