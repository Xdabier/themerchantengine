import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, readRepoFile, readTree } from './lib/repo';

/**
 * The judgement half of the retired `brand-auditor`: does the screen still
 * look like the brand. An LLM reading CSS cannot answer that; a stored
 * screenshot can.
 *
 * This guard does not compare pixels. It checks that the mechanism is wired:
 * the visual-regression specs exist, their baselines are committed rather than
 * regenerated on each run, and `npm run gate:e2e` actually collects them. A
 * visual suite whose baselines are gitignored passes forever and tells nobody
 * anything, which is the exact failure the storefront project-coverage spec
 * was written for.
 */
const GUARD = 'visual-baselines';

const VISUAL_SPECS = [
  'apps/admin-e2e/src/visual-regression.spec.ts',
  'apps/admin-e2e/src/modules/authed-visual-regression.spec.ts',
  'apps/admin-e2e/src/modules/light-mode-baselines.spec.ts',
  'apps/storefront-e2e/src/visual-regression.journey.spec.ts',
];

function snapshotCount(specPath: string): number {
  try {
    return readdirSync(join(REPO_ROOT, `${specPath}-snapshots`)).filter((f) => f.endsWith('.png'))
      .length;
  } catch {
    return 0;
  }
}

describe(GUARD, () => {
  it.each(VISUAL_SPECS)('%s exists and calls toHaveScreenshot', (specPath) => {
    const text = readRepoFile(specPath);
    expect(text).not.toBe('');
    expect(text).toContain('toHaveScreenshot');
  });

  it.each(VISUAL_SPECS)('%s has committed baselines', (specPath) => {
    expect(snapshotCount(specPath)).toBeGreaterThan(0);
  });

  it('keeps the baselines out of .gitignore, so a missing one fails rather than regenerating', () => {
    const ignored = readRepoFile('.gitignore');
    // Only the -actual- and -diff- artefacts a failed run writes may be ignored.
    for (const line of ignored.split('\n')) {
      const rule = line.trim();
      if (rule === '' || rule.startsWith('#')) continue;
      if (!/snapshot|screenshot/i.test(rule)) continue;
      expect(rule).toMatch(/actual|diff/);
    }
  });

  it('runs them inside npm run gate:e2e', () => {
    const scripts = JSON.parse(readRepoFile('package.json')).scripts as Record<string, string>;
    const gate = scripts['gate:e2e'];
    expect(gate).toBeDefined();
    // The admin sweep is filtered by test title. Every admin visual test title
    // carries the word "baseline"; the storefront ones run in the full sweep.
    expect(gate).toContain('baseline');
    expect(gate).toContain('storefront-e2e');
  });

  it('canary: a spec with no committed baseline is reported', () => {
    expect(snapshotCount('apps/admin-e2e/src/no-such-visual.spec.ts')).toBe(0);
  });

  it('canary: every admin visual test title still matches the gate filter', () => {
    const adminVisual = VISUAL_SPECS.filter((p) => p.startsWith('apps/admin-e2e/'));
    for (const specPath of adminVisual) {
      const titles = [...readRepoFile(specPath).matchAll(/^\s*test\(\s*`([^`]*)`/gm)].map(
        (m) => m[1],
      );
      expect(titles.length).toBeGreaterThan(0);
      expect(titles.every((t) => /journey|baseline/.test(t))).toBe(true);
    }
  });

  it('finds no visual spec outside the declared list, so a new one cannot go unwired', () => {
    const found = readTree({
      dirs: ['apps/admin-e2e/src', 'apps/storefront-e2e/src'],
      extensions: ['.ts'],
    })
      .filter((f) => f.text.includes('toHaveScreenshot('))
      .map((f) => f.path);
    expect(found.sort()).toEqual([...VISUAL_SPECS].sort());
  });
});
