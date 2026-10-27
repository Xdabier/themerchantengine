import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The seed runs inside the slim runtime image, which ships `prisma/`, the
 * generated client and one library subtree, `libs/shared/common/src`
 * (`apps/api/Dockerfile`). A value import from anywhere else resolves on a
 * developer box and dies with MODULE_NOT_FOUND on the first deploy, which is
 * exactly the failure the post-implementation review of E1 found. Type-only
 * imports are erased and may point anywhere.
 *
 * The install stepper runs `apps/api/scripts/*.ts` the same way, so the rule
 * covers them too. ts-node ignores the `paths` of `tsconfig.base.json`, so a
 * path alias such as `@common/*` dies the same way.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const ALLOWED = /^\.\.\/(\.\.\/)*libs\/shared\/common\/src\//;
const ALIASES = Object.keys(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions.paths,
).map((key) => key.replace(/\/\*$/, ''));

function isAlias(spec: string): boolean {
  return ALIASES.some((alias) => spec === alias || spec.startsWith(`${alias}/`));
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('prisma value imports stay inside the runtime image', () => {
  const files = [
    ...tsFilesUnder(path.join(ROOT, 'prisma')),
    ...tsFilesUnder(path.join(ROOT, 'apps', 'api', 'scripts')),
  ];

  it('scans a non-empty set of seed sources and the api scripts', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain(path.join(ROOT, 'apps', 'api', 'scripts', 'create-admin.ts'));
  });

  it('treats a tsconfig path alias as an offender', () => {
    expect(isAlias('@common/locale/store-locales')).toBe(true);
    expect(isAlias('@prisma/client')).toBe(false);
  });

  for (const file of files) {
    it(`${path.relative(ROOT, file)} imports only prisma/ and libs/shared/common/src`, () => {
      const source = fs.readFileSync(file, 'utf8');
      const offenders: string[] = [];
      const re = /^import\s+(?!type\s)[^'"]*from\s+['"]([^'"]+)['"]/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        const spec = m[1];
        if (isAlias(spec)) {
          offenders.push(spec);
          continue;
        }
        if (!spec.startsWith('.')) continue; // a package, present in node_modules
        if (!spec.includes('/libs/') && !spec.includes('/apps/')) continue; // inside prisma/
        if (ALLOWED.test(spec)) continue;
        offenders.push(spec);
      }
      expect(offenders).toEqual([]);
    });
  }
});
