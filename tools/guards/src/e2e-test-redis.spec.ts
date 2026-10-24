import { expectNoViolations, lineAt, readTree, SourceFile, Violation } from './lib/repo';

/**
 * An e2e harness points its test API at the test Redis through
 * `REDIS_TEST_HOST` and `REDIS_TEST_PORT`, never through `REDIS_HOST` and
 * `REDIS_PORT`.
 *
 * Nx loads `.env` into every task it runs, so inside a Playwright config or a
 * globalSetup `process.env['REDIS_PORT']` is the dev Redis (56379), not unset.
 * A `process.env['REDIS_PORT'] ?? '56380'` fallback therefore never falls back.
 * The storefront harness did exactly that: its test API cached and served the
 * dev Redis sitemap, built for the dev storefront on 53300, while globalSetup
 * flushed the test Redis on 56380. The suite stopped in globalSetup, and every
 * write the test API cached landed in the dev Redis.
 */
const GUARD = 'e2e-test-redis';

const HARNESS_DIRS = ['apps/storefront-e2e', 'apps/admin-e2e', 'apps/admin-services-e2e'];

const HARNESS_FILE = /(playwright(\.[a-z]+)?\.config|global-setup|global-teardown)\.ts$/;

const DEV_REDIS_READ = /process\.env(?:\.|\[\s*['"`])(REDIS_HOST|REDIS_PORT)\b/g;

export function check(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!HARNESS_FILE.test(file.path)) continue;
    for (const match of file.text.matchAll(DEV_REDIS_READ)) {
      const name = match[1];
      violations.push({
        file: file.path,
        line: lineAt(file.text, match.index ?? 0),
        message: `reads ${name}, which Nx fills from .env with the dev Redis. Read ${name.replace('REDIS_', 'REDIS_TEST_')} instead.`,
      });
    }
  }
  return violations;
}

describe(GUARD, () => {
  const files = readTree({ dirs: HARNESS_DIRS, extensions: ['.ts'] });

  it('points every e2e harness at the test Redis variables', () => {
    expectNoViolations(check(files));
  });

  it('reads the harness files, so a path regression cannot pass as clean', () => {
    const paths = files.filter((file) => HARNESS_FILE.test(file.path)).map((file) => file.path);
    expect(paths).toContain('apps/storefront-e2e/playwright.config.ts');
    expect(paths).toContain('apps/storefront-e2e/src/global-setup.ts');
    expect(paths).toContain('apps/admin-e2e/global-setup.ts');
  });

  it('canary: turns red on a harness that reads the dev Redis port', () => {
    const violations = check([
      {
        path: 'apps/storefront-e2e/playwright.config.ts',
        text: "env: {\n  REDIS_HOST: process.env['REDIS_HOST'] ?? 'localhost',\n  REDIS_PORT: process.env.REDIS_PORT ?? '56380',\n}",
      },
    ]);
    expect(violations.map((v) => [v.line, v.message.split(',')[0]])).toEqual([
      [2, 'reads REDIS_HOST'],
      [3, 'reads REDIS_PORT'],
    ]);
  });

  it('canary: stays green on the test Redis variables and outside harness files', () => {
    expect(
      check([
        {
          path: 'apps/storefront-e2e/playwright.config.ts',
          text: "env: { REDIS_PORT: process.env['REDIS_TEST_PORT'] ?? '56380' }",
        },
        { path: 'apps/storefront-e2e/src/x.journey.spec.ts', text: "process.env['REDIS_PORT']" },
      ]),
    ).toEqual([]);
  });
});
