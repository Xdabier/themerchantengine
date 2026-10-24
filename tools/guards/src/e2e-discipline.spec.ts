import {
  expectNoViolations,
  readCanary,
  readTree,
  matchAll,
  SourceFile,
  Violation,
} from './lib/repo';

/**
 * Constitution 3.8 and 3.11: journey specs drive the real backend, nothing is
 * closed with a skip, and every storefront journey carries the hardening layers
 * the storefront-e2e plan mandates.
 *
 * Replaces the six retired storefront hardening auditors plus the fixture-creep
 * half of the retired `e2e-phase-runner` protocol.
 */
const GUARD = 'e2e-discipline';

const SCANNED_DIRS = [
  'apps/admin-e2e/src',
  'apps/storefront-e2e/src',
  'apps/admin-services-e2e/src',
];

/** `page.route()` turns a journey into a fixture test. */
const FIXTURE_ROUTE = /\bpage\.route\(/;

/** The declaration forms that remove a test from the run. Playwright's
 * conditional annotation - `test.skip(someCondition, 'reason')` inside a test
 * body - is a legitimate runtime guard and is not matched here: the ban is on
 * closing a failure, not on skipping a case the seed cannot produce. */
const DISABLED_TEST = new RegExp(
  [
    // `test.skip('name', fn)` and `it.skip('name', fn)`: a declaration.
    String.raw`\b(?:test|it)\.skip\(\s*['"\`]`,
    // Every block-level disable, including the Jasmine-style aliases.
    String.raw`\b(?:test|it|describe)\.describe\.skip\(`,
    String.raw`\bdescribe\.skip\(`,
    String.raw`\bx(?:describe|it|test)\(`,
    // `.only` anywhere: an exclusive test silently drops the rest of the file.
    String.raw`\b(?:test|it|describe)(?:\.describe)?\.only\(`,
    // `test.fixme` is a skip with a nicer name.
    String.raw`\b(?:test|it)(?:\.describe)?\.fixme\(`,
  ].join('|'),
);

/**
 * What makes a journey a mutation journey.
 *
 * An API write is the obvious signal, but it is not the only one: the auth
 * journey registers an account and signs in entirely through helpers and form
 * submits, and the first version of this guard read it as read-only and never
 * asked it for a reload step. So a sign-up or session helper counts, and so
 * does a submit-shaped interaction.
 */
const MUTATION_SIGNALS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  {
    name: 'an API write',
    pattern: /\.(?:post|patch|put|delete)\(|method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/,
  },
  {
    name: 'an account or session helper',
    pattern: /\b(?:signUpViaApi|signInViaApi|attachAuthToBrowser)\b/,
  },
  {
    name: 'a submit-shaped interaction',
    pattern:
      /getBy(?:Role|TestId)\((['"])?(?:button|submit)?[^)]*(?:submit|save|add-to|add to|register|sign-?up|sign-?in|checkout|place-?order|apply|subscribe)/i,
  },
];

function mutates(text: string): boolean {
  return MUTATION_SIGNALS.some((signal) => signal.pattern.test(text));
}

/**
 * Explicit, reviewable escape hatch, mirroring `raw-sql-approved`. The waiver
 * names the requirement it waives, so a carve-out written for the reload step
 * does not silently switch the locale matrix off as well.
 */
const WAIVER = /hardening-waived:([^\n]*)/g;

function waives(text: string, requirement: string): boolean {
  WAIVER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WAIVER.exec(text)) !== null) {
    if (match[1].includes(requirement)) return true;
  }
  return false;
}

function isSpec(path: string): boolean {
  return path.endsWith('.spec.ts');
}

function isStorefrontJourney(path: string): boolean {
  return path.startsWith('apps/storefront-e2e/src/') && path.endsWith('.journey.spec.ts');
}

export function check(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!isSpec(file.path)) continue;

    violations.push(
      ...matchAll(
        file,
        FIXTURE_ROUTE,
        () => 'page.route() in a journey spec. Journeys call the real API (constitution 3.8).',
        {
          skipComments: true,
        },
      ),
    );
    violations.push(
      ...matchAll(
        file,
        DISABLED_TEST,
        () =>
          'a test is declared skipped or exclusive. Fix the failure or escalate; never close it with skip/only (constitution 3.8).',
        { skipComments: true },
      ),
    );

    if (!isStorefrontJourney(file.path)) continue;

    if (!file.text.includes('attachConsoleBaseline')) {
      violations.push({
        file: file.path,
        line: 1,
        message: 'storefront journey without attachConsoleBaseline (storefront hardening Layer B).',
      });
    }
    if (!file.text.includes('assertClean')) {
      violations.push({
        file: file.path,
        line: 1,
        message: 'storefront journey without an assertClean() call (storefront hardening Layer B).',
      });
    }

    if (!mutates(file.text)) continue;

    // Match the call form, not the bare name. A waiver that names the
    // requirement contains the name too, so a name-only check would satisfy
    // itself and `waives()` below would never be reached.
    if (!/\bdescribeEveryLocale\(/.test(file.text) && !waives(file.text, 'describeEveryLocale')) {
      violations.push({
        file: file.path,
        line: 1,
        message:
          'mutation journey without describeEveryLocale. Run it under every locale of the active fixture, or add a "hardening-waived: describeEveryLocale - <reason>" comment.',
      });
    }
    if (!/\breloadAndAssertClean\(/.test(file.text) && !waives(file.text, 'reloadAndAssertClean')) {
      violations.push({
        file: file.path,
        line: 1,
        message:
          'mutation journey without reloadAndAssertClean. End the journey by navigating away and back, or add a "hardening-waived: reloadAndAssertClean - <reason>" comment.',
      });
    }
  }
  return violations;
}

describe(GUARD, () => {
  it('finds no fixture routes, disabled tests or unhardened storefront journeys', () => {
    expectNoViolations(check(readTree({ dirs: SCANNED_DIRS, extensions: ['.ts'] })));
  });

  it('canary: the guard turns red on every rule it enforces', () => {
    const messages = check(readCanary(GUARD)).map((v) => `${v.file} ${v.message}`);
    expect(messages.some((m) => m.includes('page.route()'))).toBe(true);
    expect(messages.some((m) => m.includes('skipped or exclusive'))).toBe(true);
    expect(messages.some((m) => m.includes('without attachConsoleBaseline'))).toBe(true);
    expect(messages.some((m) => m.includes('without an assertClean()'))).toBe(true);
    expect(messages.some((m) => m.includes('without describeEveryLocale'))).toBe(true);
    expect(messages.some((m) => m.includes('without reloadAndAssertClean'))).toBe(true);
  });

  it('canary: every disable form is caught, and the conditional annotation is not', () => {
    const caught = (body: string): number =>
      check([{ path: 'apps/admin-e2e/src/modules/x.journey.spec.ts', text: body }]).length;
    for (const form of [
      "test.skip('name', async () => {});",
      "it.skip('name', async () => {});",
      'test.only(async () => {});',
      'describe.only(async () => {});',
      'test.describe.skip(async () => {});',
      'describe.skip(async () => {});',
      'xdescribe(async () => {});',
      'xit(async () => {});',
      'test.fixme(async () => {});',
    ]) {
      expect(caught(form)).toBeGreaterThan(0);
    }
    // Playwright's runtime annotation stays legal: it skips a case the seed
    // cannot produce, which is not the same as closing a failure.
    expect(caught("test.skip(!isDesktop(page), 'desktop chrome only');")).toBe(0);
  });

  it('canary: a UI-only mutation journey is classified as mutating', () => {
    const uiOnly = [
      {
        path: 'apps/storefront-e2e/src/x.journey.spec.ts',
        text: 'attachConsoleBaseline; assertClean; await signUpViaApi(request, {});',
      },
      {
        path: 'apps/storefront-e2e/src/y.journey.spec.ts',
        text: "attachConsoleBaseline; assertClean; await page.getByTestId('auth-register-submit').click();",
      },
    ];
    for (const file of uiOnly) {
      const messages = check([file]).map((v) => v.message);
      expect(messages.some((m) => m.includes('without reloadAndAssertClean'))).toBe(true);
    }
  });

  it('canary: a waiver naming one requirement does not silence the other', () => {
    const file = {
      path: 'apps/storefront-e2e/src/z.journey.spec.ts',
      text: [
        '// hardening-waived: reloadAndAssertClean - read-only view.',
        'attachConsoleBaseline; assertClean; await signUpViaApi(request, {});',
      ].join('\n'),
    };
    const messages = check([file]).map((v) => v.message);
    expect(messages.some((m) => m.includes('without reloadAndAssertClean'))).toBe(false);
    expect(messages.some((m) => m.includes('without describeEveryLocale'))).toBe(true);
  });

  it('canary: a conditional test.skip and a waived journey stay green', () => {
    const allowed = readCanary(GUARD).filter((f) => f.path.includes('allowed'));
    expect(allowed.length).toBeGreaterThan(0);
    expect(check(allowed)).toEqual([]);
  });
});
