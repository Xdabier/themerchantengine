import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The locale catalogue lives in the registry (DR-33). A second copy of it in a
 * prisma script, such as a `['fr', 'en', 'ar']` array or a static RTL set,
 * goes stale the day a locale is added.
 */
const LOCALE_ARRAY = /\[\s*'(?:fr|en|ar)'\s*,\s*'(?:fr|en|ar)'/;
const STATIC_RTL_SET = /\bRTL_LOCALES\b/;

export function findLocaleLists(source: string): string[] {
  const hits: string[] = [];
  if (LOCALE_ARRAY.test(source)) hits.push('locale array literal');
  if (STATIC_RTL_SET.test(source)) hits.push('static RTL set');
  return hits;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'migrations') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('prisma scripts do not copy the locale catalogue', () => {
  it('canary: the scanner flags a locale array and a static RTL set', () => {
    expect(findLocaleLists("const LOCALES = ['fr', 'en', 'ar'] as const;")).toEqual([
      'locale array literal',
    ]);
    expect(findLocaleLists("const RTL_LOCALES = new Set(['ar']);")).toEqual(['static RTL set']);
    expect(findLocaleLists('const codes = registryLocaleCodes();')).toEqual([]);
  });

  it('no prisma source file carries its own locale list', () => {
    const root = join(__dirname, '..');
    const offenders = sourceFiles(root)
      .map((file) => ({
        file: relative(root, file),
        hits: findLocaleLists(readFileSync(file, 'utf8')),
      }))
      .filter((entry) => entry.hits.length > 0);
    expect(offenders).toEqual([]);
  });
});
