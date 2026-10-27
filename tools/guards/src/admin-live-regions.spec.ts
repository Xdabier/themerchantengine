import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, readCanary, readTree, report } from './lib/repo';
import {
  LIVE_REGION_DIRS,
  LIVE_REGION_EXTENSIONS,
  LiveRegionViolation,
  baselineKey,
  countByKey,
  liveRegionViolations,
} from './lib/live-regions';
import baseline from './baselines/live-regions.json';

/**
 * A live region announces its content changes only when it was in the DOM
 * before the change. An element with `role="alert"`, `role="status"` or an
 * `aria-live` attribute that is the first thing inside an `@if`, `@else`,
 * `@case` or `@default` block is
 * created together with its message, so most screen readers say nothing. The
 * fix is a persistent wrapper whose content is conditional.
 *
 * Replaces the one finding the retired `a11y-auditor` made on nearly every
 * admin phase (AU1, R4, R5, R6, R8 and R9 in specs/admin-dashboard/phase-log.md),
 * which neither the admin ESLint config nor the axe assertions in the journeys
 * can see: axe only checks what is mounted.
 *
 * The rule is a delta against a committed baseline, like lane-styling: the
 * tree carries the debt in 51 files and fixing it is a UI change that
 * belongs in its own phase with the journeys to prove it. What the guard buys
 * today is that the debt cannot grow. `GUARDS_UPDATE_BASELINE=1 nx run
 * guards:test` rewrites the baseline and then fails, so a rewrite cannot be
 * mistaken for a passing run.
 */
const GUARD = 'admin-live-regions';

const BASELINE_PATH = join(REPO_ROOT, 'tools/guards/src/baselines/live-regions.json');

function currentViolations(): LiveRegionViolation[] {
  return liveRegionViolations(
    readTree({ dirs: LIVE_REGION_DIRS, extensions: LIVE_REGION_EXTENSIONS }),
  );
}

export function check(
  violations: readonly LiveRegionViolation[],
  against: Readonly<Record<string, number>>,
): LiveRegionViolation[] {
  const seen = new Map<string, number>();
  const regressions: LiveRegionViolation[] = [];
  for (const violation of violations) {
    const key = baselineKey(violation);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > (against[key] ?? 0)) regressions.push(violation);
  }
  return regressions;
}

describe(GUARD, () => {
  it('mounts no new live region inside a conditional block beyond the baseline', () => {
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
        `${regressions.length} new conditionally mounted live region(s):\n${report(regressions)}`,
      );
    }
  });

  it('reads the admin tree, so a path regression cannot pass as a clean tree', () => {
    const files = readTree({ dirs: LIVE_REGION_DIRS, extensions: LIVE_REGION_EXTENSIONS });
    expect(files.length).toBeGreaterThan(100);
  });

  it('canary: a live region as the first child of @if, @else, @case and @default turns red', () => {
    const bad = readCanary(GUARD).filter((f) => f.path.includes('conditional'));
    expect(bad).toHaveLength(1);
    const found = liveRegionViolations(bad);
    expect(found.map((v) => v.line)).toEqual([4, 7, 14, 22, 25, 29, 32]);
    expect(found.map((v) => v.marker)).toEqual([
      'role="alert"',
      'role="status"',
      'role="status"',
      'role="status"',
      'role="alert"',
      'aria-live="polite"',
      'aria-live="assertive"',
    ]);
    expect(found.every((v) => v.message.startsWith('conditional-live-region:'))).toBe(true);
  });

  it('canary: a persistent wrapper with conditional content stays green', () => {
    const allowed = readCanary(GUARD).filter((f) => f.path.includes('persistent'));
    expect(allowed).toHaveLength(1);
    expect(liveRegionViolations(allowed)).toEqual([]);
  });

  it('canary: a new violation in a baselined file is reported, an existing count is not', () => {
    const bad = readCanary(GUARD).filter((f) => f.path.includes('conditional'));
    const found = liveRegionViolations(bad);
    const key = baselineKey(found[0]);
    expect(check(found, { [key]: found.length })).toEqual([]);
    expect(check(found, { [key]: found.length - 1 })).toHaveLength(1);
  });
});
