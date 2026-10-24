import {
  expectNoViolations,
  matchAll,
  readCanary,
  readTree,
  SourceFile,
  Violation,
} from './lib/repo';

/**
 * DR-33: the locale set is runtime config. Runtime and e2e support code reads the
 * registry or the store's enabled locales; it never spells out a locale pair or a
 * `|| 'fr'` fallback rung. Unit specs are out of scope: they pin literal fixtures.
 */
const GUARD = 'locale-literals';

const PATTERNS: readonly { readonly regex: RegExp; readonly what: string }[] = [
  { regex: /\[\s*'(?:ar|fr|en)'\s*,\s*'(?:ar|fr|en)'/, what: 'locale array literal' },
  { regex: /'(?:ar|fr|en)'\s*\|\s*'(?:ar|fr|en)'/, what: 'locale union type' },
  { regex: /(?:\|\||\?\?)\s*'(?:ar|fr|en)'/, what: 'locale fallback rung' },
];

const SCANNED_DIRS = ['apps', 'libs', 'tools', 'test'];
const SCANNED_EXTENSIONS = ['.ts', '.html'];

const OUT_OF_SCOPE = [
  /\.spec\.ts$/,
  /\.e2e-spec\.ts$/,
  /\/__fixtures__\//,
  /\/testing\//,
  /\.mock\.ts$/,
  /^tools\/guards\//,
  /^libs\/shared\/common\/src\/locale\/(?:locale-registry|test-locale-sets)\.ts$/,
];

export function check(files: readonly SourceFile[]): Violation[] {
  return files
    .filter((file) => !OUT_OF_SCOPE.some((pattern) => pattern.test(file.path)))
    .flatMap((file) =>
      PATTERNS.flatMap(({ regex, what }) =>
        matchAll(
          file,
          regex,
          () => `${what}. Read the registry or the store's enabled locales instead (DR-33).`,
          { skipComments: true },
        ),
      ),
    );
}

describe(GUARD, () => {
  it('no runtime or e2e support file hardcodes a locale pair or fallback rung', () => {
    expectNoViolations(check(readTree({ dirs: SCANNED_DIRS, extensions: SCANNED_EXTENSIONS })));
  });

  it('canary: the guard turns red on an array, a union and both fallback rungs', () => {
    const violations = check(readCanary(GUARD));
    expect(violations.map((v) => v.message.split('.')[0]).sort()).toEqual([
      'locale array literal',
      'locale fallback rung',
      'locale fallback rung',
      'locale union type',
    ]);
  });
});
