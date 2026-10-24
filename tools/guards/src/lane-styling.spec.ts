import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, readCanary, readTree, report } from './lib/repo';
import {
  ABSOLUTE_RULES,
  LANES,
  LaneViolation,
  SCANNED_EXTENSIONS,
  baselineKey,
  countByKey,
  laneViolations,
} from './lib/lane-styling';
import baseline from './baselines/lane-styling.json';

/**
 * Constitution 3.9, 3.10, 3.11 and 3.2 on the admin and storefront surfaces:
 * logical CSS only, no raw `[innerHTML]`, no hex colour outside the token
 * file, no hardcoded locale comparison.
 *
 * Replaces the mechanical half of the retired `brand-auditor` and the grep
 * rules of the retired `post-edit.sh` hook. The judgement half of the brand
 * lane (does the screen look like the brand) stays with the visual-regression
 * Playwright projects.
 *
 * The physical-CSS and hex rules are a delta against a committed baseline: the
 * tree carries real debt there, most of it `text-left`/`text-right` in admin
 * table headers, and converting it is a UI change that belongs in its own
 * phase with the visual baselines to prove it. What the guard buys today is
 * that the debt cannot grow.
 *
 * The XSS rule is not in that baseline. `inner-html-binding` is absolute, with
 * a named `innerhtml-approved:` comment next to each legitimate binding, so a
 * new one cannot arrive by trading it against a fixed table header.
 *
 * The baseline is keyed on file **and rule** for the same reason: a per-file
 * count lets a file shed one violation, gain a different one, and stay green.
 * `GUARDS_UPDATE_BASELINE=1 nx run guards:test` rewrites it and then fails, so
 * a rewrite cannot be mistaken for a passing run.
 */
const GUARD = 'lane-styling';

const BASELINE_PATH = join(REPO_ROOT, 'tools/guards/src/baselines/lane-styling.json');

function currentViolations(): LaneViolation[] {
  return Object.values(LANES).flatMap((lane) =>
    laneViolations(readTree({ dirs: [...lane.dirs], extensions: SCANNED_EXTENSIONS }), lane),
  );
}

export function check(
  violations: readonly LaneViolation[],
  against: Readonly<Record<string, number>>,
): LaneViolation[] {
  const seen = new Map<string, number>();
  const regressions: LaneViolation[] = [];
  for (const violation of violations) {
    const key = baselineKey(violation);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    // Violations arrive in line order, so the ones past the allowance are the
    // later ones in the file, which is the closest a static scan gets to "the
    // new one".
    if (count > (against[key] ?? 0)) regressions.push(violation);
  }
  return regressions;
}

describe(GUARD, () => {
  it('adds no physical CSS, hex literal or locale literal beyond the baseline', () => {
    const violations = currentViolations();
    if (process.env['GUARDS_UPDATE_BASELINE'] === '1') {
      const counts = countByKey(violations);
      writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify(counts, Object.keys(counts).sort(), 2)}\n`,
        'utf8',
      );
      throw new Error(
        `${GUARD}: baseline rewritten with ${Object.keys(counts).length} entries. Commit the diff, justify any growth, and re-run without GUARDS_UPDATE_BASELINE.`,
      );
    }
    const regressions = check(violations, baseline as Record<string, number>);
    if (regressions.length > 0) {
      throw new Error(
        `${regressions.length} new lane-styling violation(s):\n${report(regressions)}`,
      );
    }
  });

  it('keeps the XSS rule out of the baseline, where a count could hide it', () => {
    expect(ABSOLUTE_RULES).toContain('inner-html-binding');
    for (const key of Object.keys(baseline as Record<string, number>)) {
      for (const rule of ABSOLUTE_RULES) {
        expect(key.endsWith(`::${rule}`)).toBe(false);
      }
    }
  });

  it('reads the lane trees, so a path regression cannot pass as a clean tree', () => {
    const adminFiles = readTree({ dirs: [...LANES.admin.dirs], extensions: SCANNED_EXTENSIONS });
    const storefrontFiles = readTree({
      dirs: [...LANES.storefront.dirs],
      extensions: SCANNED_EXTENSIONS,
    });
    expect(adminFiles.length).toBeGreaterThan(100);
    expect(storefrontFiles.length).toBeGreaterThan(100);
  });

  it('canary: the guard turns red on every rule it enforces', () => {
    const messages = laneViolations(readCanary(GUARD), LANES.admin).map((v) => v.message);
    for (const id of [
      'physical-text-align',
      'physical-spacing-utility',
      'physical-positioning-utility',
      'physical-css-property',
      'inner-html-binding',
      'hardcoded-locale',
      'hardcoded-hex-colour',
    ]) {
      expect(messages.some((m) => m.startsWith(`${id}:`))).toBe(true);
    }
  });

  it('canary: an approval covers its own binding and not a later one in the same file', () => {
    const fixture = readCanary(GUARD).filter((f) => f.path.includes('second-binding'));
    expect(fixture).toHaveLength(1);
    const found = laneViolations(fixture, LANES.admin).filter(
      (v) => v.rule === 'inner-html-binding',
    );
    // Two bindings, one approval directly above the first. A file-scoped
    // waiver would report neither, which is the hole this closes.
    expect(found).toHaveLength(1);
    expect(found[0].line).toBeGreaterThan(15);
  });

  it('canary: a logical-property component with an approved innerHTML stays green', () => {
    const allowed = readCanary(GUARD).filter((f) => f.path.includes('allowed'));
    expect(allowed.length).toBeGreaterThan(0);
    expect(laneViolations(allowed, LANES.admin)).toEqual([]);
  });

  it('canary: a file cannot trade one violation for another and stay green', () => {
    const before: LaneViolation[] = [
      { rule: 'physical-text-align', file: 'a.ts', line: 1, message: 'x' },
      { rule: 'hardcoded-hex-colour', file: 'a.ts', line: 2, message: 'y' },
    ];
    const asBaseline = countByKey(before);
    expect(check(before, asBaseline)).toEqual([]);

    // Same file, same total count, different rules. A per-file baseline would
    // have called this clean.
    const after: LaneViolation[] = [
      { rule: 'physical-text-align', file: 'a.ts', line: 1, message: 'x' },
      { rule: 'hardcoded-locale', file: 'a.ts', line: 9, message: 'z' },
    ];
    expect(check(after, asBaseline)).toHaveLength(1);
    expect(check(after, asBaseline)[0].rule).toBe('hardcoded-locale');
  });

  it('canary: the regression reported is the later line, not whichever rule ran first', () => {
    const asBaseline = { 'a.ts::physical-text-align': 1 };
    const violations: LaneViolation[] = [
      { rule: 'physical-text-align', file: 'a.ts', line: 3, message: 'old' },
      { rule: 'physical-text-align', file: 'a.ts', line: 90, message: 'new' },
    ];
    const regressions = check(violations, asBaseline);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].line).toBe(90);
  });
});
