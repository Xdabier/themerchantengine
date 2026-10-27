import { expectNoViolations, readTree, SourceFile, Violation, lineAt } from './lib/repo';

/**
 * An e2e spec gated on an environment variable that nothing ever sets is a
 * spec that never runs.
 *
 * `project-coverage.spec.ts` in the storefront suite already checks that every
 * spec file is collected by at least one Playwright project, for exactly this
 * reason: a file that collects zero tests is not skipped and does not error,
 * the run is green, and an auditor greps for the spec and finds it. An
 * `if (process.env['X'] === '1')` block around a describe is the same failure
 * one level down. The file is collected, the tests inside it are never
 * declared, and nothing reports a thing.
 *
 * Phase O2 found this the hard way: `STOREFRONT_E2E_BUILT` gates the
 * authenticated journeys in sixteen storefront specs, and no script, config,
 * hook or CI workflow in the repository sets it.
 */
const GUARD = 'e2e-env-gates';

const SPEC_DIRS = ['apps/storefront-e2e/src', 'apps/admin-e2e/src', 'apps/admin-services-e2e/src'];

/** Where a variable can legitimately be set for an e2e run. */
const SETTER_FILES = [
  'package.json',
  'apps/storefront-e2e/playwright.config.ts',
  'apps/storefront-e2e/global-setup.ts',
  'apps/admin-e2e/playwright.config.ts',
  'apps/admin-e2e/global-setup.ts',
  '.github/workflows/ci.yml',
];

const SETTER_DIRS = ['scripts', 'tools/setup/src', '.claude/hooks'];

const ENV_READ = /process\.env\[?['"]([A-Z][A-Z0-9_]{3,})['"]\]?/g;

/** A gate whose only purpose is to describe the environment, not to switch
 * tests on and off. These are read for a value, never as a boolean tier gate. */
const VALUE_ONLY = new Set(['BASE_URL', 'CI']);

/** Known, deliberate: recorded so the list is a decision rather than a gap. */
const ACCEPTED_UNSET: Readonly<Record<string, string>> = {
  // Phase O2 finding. Sixteen storefront specs gate their authenticated
  // journeys on this and nothing sets it, so those journeys have never run in
  // an automated sweep. Building the tier that sets it is its own phase; the
  // entry here keeps the number visible instead of letting it read as covered.
  STOREFRONT_E2E_BUILT:
    'no built-tier runner exists yet; recorded in specs/features/llm-setup-optimization/tasks.md',
};

export function readGates(files: readonly SourceFile[]): Map<string, Violation[]> {
  const gates = new Map<string, Violation[]>();
  for (const file of files) {
    if (!file.path.endsWith('.spec.ts')) continue;
    ENV_READ.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ENV_READ.exec(file.text)) !== null) {
      const name = match[1];
      if (VALUE_ONLY.has(name)) continue;
      const found = gates.get(name) ?? [];
      found.push({ file: file.path, line: lineAt(file.text, match.index), message: name });
      gates.set(name, found);
    }
  }
  return gates;
}

export function check(
  gates: ReadonlyMap<string, Violation[]>,
  setterText: string,
  accepted: Readonly<Record<string, string>>,
): Violation[] {
  const violations: Violation[] = [];
  for (const [name, sites] of gates) {
    if (name in accepted) continue;
    if (setterText.includes(name)) continue;
    violations.push({
      file: sites[0].file,
      line: sites[0].line,
      message: `${name} gates ${sites.length} e2e site(s) and nothing in the repository sets it. A test behind a gate nobody turns on never runs, and the suite stays green.`,
    });
  }
  return violations;
}

describe(GUARD, () => {
  const specs = readTree({ dirs: SPEC_DIRS, extensions: ['.ts'] });
  const setterText = [
    ...SETTER_FILES.map((path) => readTree({ dirs: [path] })),
    ...SETTER_DIRS.map((dir) => readTree({ dirs: [dir] })),
  ]
    .flat()
    .map((file) => file.text)
    .join('\n');

  it('finds every e2e environment gate set somewhere, or accepted on the record', () => {
    expectNoViolations(check(readGates(specs), setterText, ACCEPTED_UNSET));
  });

  it('reads the spec trees and the setter files, so a path regression cannot pass as clean', () => {
    expect(specs.length).toBeGreaterThan(50);
    expect(setterText.length).toBeGreaterThan(10_000);
    expect(readGates(specs).size).toBeGreaterThan(2);
  });

  it('every accepted gate is still read by a spec, so the list cannot rot', () => {
    const gates = readGates(specs);
    for (const name of Object.keys(ACCEPTED_UNSET)) {
      expect(gates.has(name)).toBe(true);
    }
  });

  it('canary: turns red on a gate nothing sets', () => {
    const gates = readGates([
      {
        path: 'apps/storefront-e2e/src/x.journey.spec.ts',
        text: "if (process.env['NEVER_SET_ANYWHERE'] === '1') {}",
      },
    ]);
    const messages = check(gates, 'unrelated setter text', {}).map((v) => v.message);
    expect(messages.some((m) => m.includes('NEVER_SET_ANYWHERE'))).toBe(true);
  });

  it('canary: stays green once something sets it, or once it is accepted', () => {
    const gates = readGates([
      {
        path: 'apps/storefront-e2e/src/x.journey.spec.ts',
        text: "if (process.env['SOME_TIER'] === '1') {}",
      },
    ]);
    expect(check(gates, 'SOME_TIER=1 npx playwright test', {})).toEqual([]);
    expect(check(gates, 'nothing', { SOME_TIER: 'deliberate, see the tasks file' })).toEqual([]);
  });
});
