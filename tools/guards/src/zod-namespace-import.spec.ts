import {
  expectNoViolations,
  readCanary,
  readTree,
  matchAll,
  SourceFile,
  Violation,
} from './lib/repo';

/**
 * Browser bundles must import Zod as a namespace. The named `{ z }` import
 * pulls the whole library into the admin initial bundle and broke the
 * Lighthouse performance budget on the auth pages.
 */
const GUARD = 'zod-namespace-import';

const SCANNED_DIRS = ['libs', 'apps/admin/src', 'apps/storefront/src'];

const NAMED_Z_IMPORT = /import\s*\{[^}]*\bz\b[^}]*\}\s*from\s*['"]zod['"]/;

export function check(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!file.path.endsWith('.ts')) continue;
    if (file.path.endsWith('.spec.ts')) continue;
    violations.push(
      ...matchAll(
        file,
        NAMED_Z_IMPORT,
        () => "import { z } from 'zod' defeats tree-shaking. Use import * as z from 'zod'.",
        { skipComments: true },
      ),
    );
  }
  return violations;
}

describe(GUARD, () => {
  it('finds no named z import from zod in the browser trees', () => {
    expectNoViolations(check(readTree({ dirs: SCANNED_DIRS, extensions: ['.ts'] })));
  });

  it('canary: the guard turns red on a fixture that uses the named import', () => {
    const violations = check(readCanary(GUARD));
    expect(violations.map((v) => v.file)).toEqual(['libs/admin-types/src/bad.ts']);
  });

  it('canary: the guard stays green on a fixture that uses the namespace import', () => {
    const good = readCanary(GUARD).filter((f) => f.path.endsWith('good.ts'));
    expect(good.length).toBe(1);
    expect(check(good)).toEqual([]);
  });
});
