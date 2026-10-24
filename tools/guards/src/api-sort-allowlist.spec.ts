import { expectNoViolations, readCanary, readTree, SourceFile, Violation } from './lib/repo';
import { parseClasses } from './lib/ts-class';

/**
 * Constitution 3.5: sort fields come from a per-endpoint column allowlist and
 * are never interpolated from request input.
 *
 * Replaces the sort half of the retired `db-safety-auditor`. A `sortBy` that
 * reaches Prisma's `orderBy` unchecked is a column-name injection into the
 * query plan and a disclosure channel for columns the projection hides.
 */
const GUARD = 'api-sort-allowlist';

const SORT_FIELD = /^(?:sort|sortBy|orderBy|sort_by|sortField)$/;

/** Either the field itself is a closed set, or the module resolves it against
 * a named allowlist constant before it reaches the query. */
const INLINE_ALLOWLIST = /@(?:IsIn|IsEnum)\(/;
const ALLOWLIST_CONSTANT = /\b[A-Z][A-Z0-9_]*(?:SORT_FIELDS|SORT_COLUMNS|SORTABLE[A-Z0-9_]*)\b/;

/** `apps/api/src/modules/products/dto/query-products.dto.ts` -> `apps/api/src/modules/products/` */
function moduleRootOf(path: string): string {
  const marker = path.lastIndexOf('/dto/');
  return marker === -1 ? path.slice(0, path.lastIndexOf('/') + 1) : path.slice(0, marker + 1);
}

export function check(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!file.path.endsWith('.dto.ts')) continue;
    for (const parsed of parseClasses(file)) {
      for (const member of parsed.members) {
        if (!SORT_FIELD.test(member.name)) continue;
        if (member.decorators.some((d) => INLINE_ALLOWLIST.test(d))) continue;

        const moduleRoot = moduleRootOf(file.path);
        const resolvesIt = files.some(
          (candidate) =>
            candidate.path.startsWith(moduleRoot) &&
            !candidate.path.endsWith('.spec.ts') &&
            ALLOWLIST_CONSTANT.test(candidate.text),
        );
        if (resolvesIt) continue;

        violations.push({
          file: file.path,
          line: member.line,
          message: `${parsed.name}.${member.name} is an open string. Close it with @IsIn([...]) or resolve it against a *_SORT_FIELDS allowlist inside ${moduleRoot} before it reaches orderBy (constitution 3.5).`,
        });
      }
    }
  }
  return violations;
}

describe(GUARD, () => {
  const apiFiles = readTree({ dirs: ['apps/api/src'], extensions: ['.ts'] });

  it('finds every sort parameter closed by an allowlist', () => {
    expectNoViolations(check(apiFiles));
  });

  it('reads the sort-bearing DTOs, so a selector regression cannot pass as a clean tree', () => {
    const sortBearing = apiFiles.filter(
      (f) =>
        f.path.endsWith('.dto.ts') &&
        parseClasses(f).some((c) => c.members.some((m) => SORT_FIELD.test(m.name))),
    );
    expect(sortBearing.length).toBeGreaterThan(5);
  });

  it('canary: the guard turns red on an open sort field with no allowlist in its module', () => {
    const violations = check(readCanary(GUARD));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.map((v) => v.file)).toContain(
      'apps/api/src/modules/bad/dto/query-bad.dto.ts',
    );
  });

  it('canary: an inline @IsIn and a module-level allowlist constant both stay green', () => {
    const allowed = readCanary(GUARD).filter((f) => f.path.includes('allowed'));
    expect(allowed.length).toBeGreaterThan(0);
    expect(check(allowed)).toEqual([]);
  });
});
