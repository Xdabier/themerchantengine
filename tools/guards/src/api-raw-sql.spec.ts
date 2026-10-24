import {
  expectNoViolations,
  readCanary,
  readTree,
  matchAll,
  SourceFile,
  Violation,
} from './lib/repo';

/**
 * Constitution 3.5: Prisma parameterized queries only. `$queryRaw` and
 * `$executeRaw` are forbidden unless the file carries an explicit
 * `raw-sql-approved: <reason + reviewer>` comment.
 *
 * Replaces the raw-SQL half of the retired `db-safety-auditor`.
 */
const GUARD = 'api-raw-sql';

const SCANNED_DIRS = ['apps/api/src', 'libs/shared'];

const RAW_SQL = /\$(queryRaw|executeRaw)(Unsafe)?\b/;
const APPROVAL = /raw-sql-approved:\s*\S+/;

export function check(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!file.path.endsWith('.ts')) continue;
    // Unit specs name `$queryRaw` when they build a mock Prisma client. That is
    // a mock shape, not a query, and no spec reaches production.
    if (file.path.endsWith('.spec.ts')) continue;
    if (APPROVAL.test(file.text)) continue;
    violations.push(
      ...matchAll(
        file,
        RAW_SQL,
        (match) =>
          `$${match[1]}${match[2] ?? ''} without a "raw-sql-approved: <reason + reviewer>" comment (constitution 3.5).`,
        { skipComments: true },
      ),
    );
  }
  return violations;
}

describe(GUARD, () => {
  it('finds no unapproved raw SQL in the API and shared trees', () => {
    expectNoViolations(check(readTree({ dirs: SCANNED_DIRS, extensions: ['.ts'] })));
  });

  it('canary: the guard turns red on a fixture that uses $queryRaw with no approval', () => {
    const violations = check(readCanary(GUARD));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.map((v) => v.file)).toContain('apps/api/src/modules/bad/bad.service.ts');
  });

  it('canary: the guard stays green on a fixture that carries the approval comment', () => {
    const approved = readCanary(GUARD).filter((f) => f.path.includes('approved'));
    expect(approved.length).toBeGreaterThan(0);
    expect(check(approved)).toEqual([]);
  });
});
