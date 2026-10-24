import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Recurrence guard for the silent-swallow class
 * (specs/features/admin-qa-remediation/plan-e-layout-polish.md, finding E11).
 *
 * A companion fetch that fails into an empty array leaves the operator with an
 * empty control and zero signal: an empty location filter, an empty roles
 * column, a missing analytics strip, all indistinguishable from "there is no
 * data". Every one of those is now a visible `app-load-error` with a retry.
 *
 * The scan is deliberately narrow — it only flags a subscribe error handler
 * whose whole body is a no-op or a "blank it out" assignment:
 *   error: () => undefined
 *   error: () => {}
 *   error: () => this.x.set([])
 *   error: () => this.x.set(null)
 * A handler that reports something, sets an error signal, or stops a spinner
 * plus reports is untouched.
 *
 * A genuinely best-effort path opts out with an explicit
 * `// query-error-guard: allow — <reason>` comment on the lines above it.
 */

const FEATURES_DIR = join(__dirname, '..', 'features');

const ALLOW_MARKER = 'query-error-guard: allow';

/** `error: () => undefined` / `error: () => {}` / `error: () => x.set([] | null)`. */
const SWALLOW =
  /error:\s*\(\s*\)\s*=>\s*(?:undefined|\{\s*\}|[\w.]+\.set\(\s*(?:\[\s*\]|null)\s*\))/g;

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = collect(FEATURES_DIR);

/** True when an allow marker sits within the three lines above the offender. */
function isAllowed(lines: string[], offenderLine: number): boolean {
  for (let i = Math.max(0, offenderLine - 3); i < offenderLine; i += 1) {
    if (lines[i].includes(ALLOW_MARKER)) return true;
  }
  return false;
}

describe('admin silent-swallow recurrence guard', () => {
  it('has feature files to scan', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no fetch failure is swallowed without an operator-visible surface', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      for (const match of src.matchAll(SWALLOW)) {
        const line = src.slice(0, match.index).split('\n').length - 1;
        if (isAllowed(lines, line)) continue;
        offenders.push(
          `${relative(FEATURES_DIR, file).replace(/\\/g, '/')}:${line + 1} → ${match[0]}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('recognizes the allow marker so best-effort paths can opt out', () => {
    const sample = [
      'this.svc.load().subscribe({',
      '  next: (v) => this.rows.set(v),',
      '  // query-error-guard: allow — thumbnail only.',
      '  error: () => this.rows.set([]),',
      '});',
    ];
    const matches = [...sample.join('\n').matchAll(SWALLOW)];
    expect(matches).toHaveLength(1);
    expect(isAllowed(sample, 3)).toBe(true);
  });

  it('still catches an unmarked swallow', () => {
    const sample = ['this.svc.load().subscribe({', '  error: () => this.rows.set([]),', '});'];
    const matches = [...sample.join('\n').matchAll(SWALLOW)];
    expect(matches).toHaveLength(1);
    expect(isAllowed(sample, 1)).toBe(false);
  });
});
