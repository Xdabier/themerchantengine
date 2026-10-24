/**
 * The Nitro server code under apps/storefront/src/server/ is bundled by
 * Nitro's own esbuild pass, which has no Angular compiler and no decorator
 * support. A value import from the `@storefront-services` barrel pulls every
 * decorated Angular service into that bundle and the production build fails
 * with "Parameter decorators only work when experimental decorators are
 * enabled". Type imports are erased and are fine; a value must come from a
 * decorator-free module by its own path.
 *
 * The production build went red this way on 2026-09-05 and stayed red until
 * the E5 install smoke built the image, because no Playwright project runs
 * the production build.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const SERVER = path.join(REPO, 'apps', 'storefront', 'src', 'server');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const BARRELS = ['@storefront-services', '@admin-services'];

describe('Nitro server code', () => {
  const files = walk(SERVER);

  it('exists and is more than one file', () => {
    expect(files.length).toBeGreaterThan(1);
  });

  it.each(files.map((f) => [path.relative(REPO, f).split(path.sep).join('/'), f]))(
    '%s imports the Angular service barrels as types only',
    (_label, file) => {
      const text = fs.readFileSync(file, 'utf8');
      for (const barrel of BARRELS) {
        const valueImports = [...text.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'([^']+)'/gm)]
          .map((m) => m[1])
          .filter((from) => from === barrel);
        expect(valueImports, `value import of ${barrel}`).toEqual([]);
      }
    },
  );

  it('the rule can fail: a value import of the barrel is caught, a type import is not', () => {
    const rule = (text: string) =>
      [...text.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'([^']+)'/gm)]
        .map((m) => m[1])
        .filter((from) => BARRELS.includes(from));
    expect(rule("import { X } from '@storefront-services';\n")).toEqual(['@storefront-services']);
    expect(rule("import type { X } from '@storefront-services';\n")).toEqual([]);
    expect(rule("import { X } from '@storefront-services/locales';\n")).toEqual([]);
  });
});
