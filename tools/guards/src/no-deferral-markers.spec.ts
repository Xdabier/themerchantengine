import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, readCanary, readTree, SourceFile, Violation, report } from './lib/repo';
import { countMarkers, SCANNED_DIRS, SCANNED_EXTENSIONS } from './lib/deferral-markers';
import baseline from './baselines/deferral-markers.json';

/**
 * Constitution 3.13: a phase does not ship deferral markers. Replaces the
 * retired `/defer-report` command.
 *
 * The rule is a delta, not an absolute. The tree carries a known set of
 * markers from before this guard existed; failing on all of them would make
 * the guard something to switch off rather than something to obey. So the
 * guard fails when a file gains markers and stays green when a file sheds
 * them, and the committed baseline is the record of what is still owed.
 *
 * Lowering the baseline is a deliberate edit to `baselines/deferral-markers.json`,
 * visible in the phase diff. `GUARDS_UPDATE_BASELINE=1 nx run guards:test`
 * rewrites it; the reviewer reads any growth in that file as a finding.
 */
const GUARD = 'no-deferral-markers';

const BASELINE_PATH = join(REPO_ROOT, 'tools/guards/src/baselines/deferral-markers.json');

export function check(
  files: readonly SourceFile[],
  against: Readonly<Record<string, number>>,
): Violation[] {
  const counts = countMarkers(files);
  const violations: Violation[] = [];
  for (const [path, hits] of Object.entries(counts)) {
    const allowed = against[path] ?? 0;
    if (hits > allowed) {
      violations.push({
        file: path,
        line: 1,
        message: `${hits - allowed} new deferral marker(s) (TODO, FIXME, HACK, XXX, deferred, stubbed, placeholder implementation, "Phase N ... later"). Strip them or open an item in the audit doc (constitution 3.13).`,
      });
    }
  }
  return violations;
}

describe(GUARD, () => {
  const files = readTree({ dirs: SCANNED_DIRS, extensions: SCANNED_EXTENSIONS });

  it('adds no deferral marker beyond the committed baseline', () => {
    if (process.env['GUARDS_UPDATE_BASELINE'] === '1') {
      const counts = countMarkers(files);
      writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify(counts, Object.keys(counts).sort(), 2)}\n`,
        'utf8',
      );
      throw new Error(
        `${GUARD}: baseline rewritten with ${Object.keys(counts).length} files. Commit the diff, justify any growth, and re-run without GUARDS_UPDATE_BASELINE.`,
      );
    }
    const violations = check(files, baseline as Record<string, number>);
    if (violations.length > 0) {
      throw new Error(
        `${violations.length} file(s) gained deferral markers:\n${report(violations)}`,
      );
    }
  });

  it('names every baselined file that still exists, so the list cannot rot', () => {
    // A cleanup must not break the build, so shedding markers is not a
    // failure. A baseline entry for a file that is gone is: it means the list
    // is carrying debt that no longer exists and hiding how much is left.
    const present = new Set(files.map((file) => file.path));
    const orphaned = Object.keys(baseline as Record<string, number>).filter(
      (path) => !present.has(path),
    );
    expect(orphaned).toEqual([]);

    const counts = countMarkers(files);
    const stale = Object.entries(baseline as Record<string, number>).filter(
      ([path, allowed]) => (counts[path] ?? 0) < allowed,
    );
    if (stale.length > 0) {
      console.warn(
        `${GUARD}: ${stale.length} file(s) now hold fewer markers than the baseline allows. Run GUARDS_UPDATE_BASELINE=1 to tighten it.`,
      );
    }
  });

  it('canary: the guard turns red when a file gains a marker', () => {
    const violations = check(readCanary(GUARD), {});
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.map((v) => v.file)).toContain('apps/admin/src/app/features/bad/bad.page.ts');
  });

  it('canary: the guard stays green when the marker is already in the baseline', () => {
    const canary = readCanary(GUARD);
    const asBaseline = countMarkers(canary);
    expect(check(canary, asBaseline)).toEqual([]);
  });
});
