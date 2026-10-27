import { expectNoViolations, lineAt, readTree, SourceFile, Violation } from './lib/repo';

/**
 * An e2e harness or journey points at the test API through
 * `STOREFRONT_E2E_API_URL`, never through `STOREFRONT_API_URL`.
 *
 * Nx loads `.env` into every task it runs, and `.env.example` sets
 * `STOREFRONT_API_URL` to the dev API on 53000. A
 * `process.env['STOREFRONT_API_URL'] ?? 'http://localhost:53001/api'` fallback
 * therefore never falls back. On a fresh checkout that copied `.env.example`,
 * the storefront dev server under test proxied every call to 53000 and every
 * journey rendered a 500 page.
 */
const GUARD = 'e2e-test-api-url';

const HARNESS_DIRS = ['apps/storefront-e2e', 'apps/admin-e2e', 'apps/admin-services-e2e'];

const DEV_API_READ = /process\.env(?:\.|\[\s*['"`])STOREFRONT_API_URL\b/g;

export function check(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(DEV_API_READ)) {
      violations.push({
        file: file.path,
        line: lineAt(file.text, match.index ?? 0),
        message:
          'reads STOREFRONT_API_URL, which Nx fills from .env with the dev API. Read STOREFRONT_E2E_API_URL instead.',
      });
    }
  }
  return violations;
}

describe(GUARD, () => {
  const files = readTree({ dirs: HARNESS_DIRS, extensions: ['.ts'] });

  it('points every e2e harness and journey at the test API variable', () => {
    expectNoViolations(check(files));
  });

  it('reads the storefront harness, so a path regression cannot pass as clean', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain('apps/storefront-e2e/playwright.config.ts');
    expect(paths).toContain('apps/storefront-e2e/src/support/auth-attach.ts');
  });

  it('canary: turns red on a read of the dev API URL', () => {
    const violations = check([
      {
        path: 'apps/storefront-e2e/src/x.journey.spec.ts',
        text: "const a = 1;\nconst API = process.env['STOREFRONT_API_URL'] ?? 'http://localhost:53001/api';\nconst B = process.env.STOREFRONT_API_URL;",
      },
    ]);
    expect(violations.map((v) => [v.line, v.message.split(',')[0]])).toEqual([
      [2, 'reads STOREFRONT_API_URL'],
      [3, 'reads STOREFRONT_API_URL'],
    ]);
  });

  it('canary: stays green on the test API variable and on the prefix variable', () => {
    expect(
      check([
        {
          path: 'apps/storefront-e2e/playwright.config.ts',
          text: "STOREFRONT_API_URL: process.env['STOREFRONT_E2E_API_URL'] ?? STOREFRONT_API_BASE,\nSTOREFRONT_API_TARGET_PREFIX: process.env['STOREFRONT_API_TARGET_PREFIX'] ?? '',",
        },
      ]),
    ).toEqual([]);
  });
});
