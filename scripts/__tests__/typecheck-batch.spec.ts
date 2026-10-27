import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without a declaration file
import {
  MAX_LINES_PER_FILE,
  collectPaths,
  filterDiagnostics,
  isWriteShaped,
  tsconfigFor,
  writeTargets,
} from '../typecheck-batch.mjs';

// The LSP covers the Edit and Write tools. This module covers the gap those two
// leave, so the cases below are the ways the gap gets missed: a path written with
// Windows separators, a solution-style tsconfig that compiles nothing, and a
// project whose unrelated pre-existing errors would drown the one line that matters.

const ROOT = join('C:', 'repo');
const hook = (command: string) => JSON.stringify({ tool_input: { command } });

describe('collectPaths', () => {
  it('finds the repository TypeScript paths a Bash command names', () => {
    expect(collectPaths(hook('cat > apps/api/src/orders/orders.service.ts <<EOF'))).toEqual([
      'apps/api/src/orders/orders.service.ts',
    ]);
  });

  it('normalises Windows separators, which is how a JSON payload carries them', () => {
    expect(collectPaths(hook('node -e "x" libs\\admin-ui\\src\\button.ts'))).toEqual([
      'libs/admin-ui/src/button.ts',
    ]);
  });

  it('collects several paths once each', () => {
    const out = collectPaths(
      hook('sed -i s/a/b/ apps/api/src/a.ts apps/api/src/a.ts tools/guards/src/b.spec.ts'),
    );
    expect(out).toEqual(['apps/api/src/a.ts', 'tools/guards/src/b.spec.ts']);
  });

  it('ignores a path outside the source roots and a non-TypeScript file', () => {
    expect(collectPaths(hook('cat node_modules/x/y.ts README.md apps/api/src/a.json'))).toEqual([]);
  });

  // The queue feeds a tsconfig path to a compiler. A path that climbs out of the
  // workspace would point it at a project nobody in this repository wrote.
  it('refuses a path that climbs out of the workspace', () => {
    expect(collectPaths(hook('cat > scripts/../../../../Users/someone/secret.ts'))).toEqual([]);
    expect(collectPaths(hook('cp a apps/../../evil/x.ts'))).toEqual([]);
  });

  it('returns nothing rather than throwing on an unreadable payload', () => {
    expect(collectPaths('not json')).toEqual([]);
    expect(collectPaths('')).toEqual([]);
  });

  // The hook reads CLAUDE_TOOL_INPUT when it is set, and that variable carries the
  // tool input on its own, not the whole event. Accepting only the wrapped shape
  // makes the queue silently stay empty, which is the failure this hook exists to
  // prevent, with no signal that it happened.
  it('reads the bare tool-input shape as well as the whole event', () => {
    const bare = JSON.stringify({ command: 'cat > apps/api/src/a.ts <<EOF' });
    expect(collectPaths(bare)).toEqual(['apps/api/src/a.ts']);
  });
});

describe('writeTargets', () => {
  const targets = (command: string) => writeTargets(JSON.stringify({ tool_input: { command } }));

  // The bug this replaced: a heredoc that writes a markdown file while quoting a
  // TypeScript path in its prose queued that path and reported the project's
  // pre-existing errors as though the session had caused them. The redirect
  // target is what was written; everything after it is content.
  it('takes the redirect target, not a path quoted in the body', () => {
    const heredoc = [
      "cat >> specs/features/x/tasks.md <<'EOF'",
      '- Finding: `apps/admin-e2e/global-setup.ts` never sets STORE_CONFIG_FIXTURE.',
      'EOF',
    ].join('\n');

    expect(targets(heredoc)).toEqual([]);
  });

  it('takes a TypeScript redirect target', () => {
    expect(targets('cat > apps/api/src/a.ts <<EOF')).toEqual(['apps/api/src/a.ts']);
    expect(targets('printf x >> apps/api/src/a.ts')).toEqual(['apps/api/src/a.ts']);
  });

  it('takes the destination of a copy or a move, not the source', () => {
    expect(targets('cp apps/api/src/a.ts apps/api/src/b.ts')).toEqual(['apps/api/src/b.ts']);
    expect(targets('mv apps/api/src/a.ts apps/api/src/b.ts')).toEqual(['apps/api/src/b.ts']);
  });

  it('takes the file sed rewrites in place, and the file tee writes', () => {
    expect(targets('sed -i s/a/b/ apps/api/src/a.ts')).toEqual(['apps/api/src/a.ts']);
    expect(targets('cat x | tee apps/api/src/a.ts')).toEqual(['apps/api/src/a.ts']);
  });

  it('takes nothing from a read', () => {
    expect(targets('cat -n apps/api/src/a.ts')).toEqual([]);
    expect(targets('git diff -- apps/api/src/a.ts')).toEqual([]);
    expect(targets('rg needle apps/api/src')).toEqual([]);
    expect(targets('npx tsc -p apps/api/tsconfig.app.json --noEmit')).toEqual([]);
  });

  it('is not fooled by a file-descriptor redirect', () => {
    expect(targets('npx nx test api 2>&1 | grep apps/api/src/a.ts')).toEqual([]);
  });

  it('returns nothing rather than throwing on an unreadable payload', () => {
    expect(writeTargets('not json')).toEqual([]);
    expect(writeTargets('')).toEqual([]);
  });
});

describe('isWriteShaped', () => {
  // The queue is meant to hold files a command WROTE. Queueing every file a
  // command merely names turns a `cat` or a `git diff` into a project-wide tsc at
  // the end of the turn, and reports pre-existing errors in a file the session
  // only read as though the session had caused them.
  const shaped = (command: string) => isWriteShaped(JSON.stringify({ tool_input: { command } }));

  it('recognises the ways this repository writes a file from Bash', () => {
    expect(shaped('cat > apps/api/src/a.ts <<EOF')).toBe(true);
    expect(shaped('printf x >> apps/api/src/a.ts')).toBe(true);
    expect(shaped('sed -i s/a/b/ apps/api/src/a.ts')).toBe(true);
    expect(shaped('cat a | tee apps/api/src/a.ts')).toBe(true);
    expect(shaped('cp apps/api/src/a.ts apps/api/src/b.ts')).toBe(true);
    expect(shaped('mv apps/api/src/a.ts apps/api/src/b.ts')).toBe(true);
  });

  it('does not treat reading a file as writing it', () => {
    expect(shaped('cat -n apps/api/src/a.ts')).toBe(false);
    expect(shaped('git diff -- apps/api/src/a.ts')).toBe(false);
    expect(shaped('rg needle apps/api/src')).toBe(false);
    expect(shaped('npm run t -- api --testFile apps/api/src/a.spec.ts')).toBe(false);
    expect(shaped('npx tsc -p apps/api/tsconfig.app.json --noEmit')).toBe(false);
  });

  it('is false on an unreadable payload rather than throwing', () => {
    expect(isWriteShaped('not json')).toBe(false);
    expect(isWriteShaped('')).toBe(false);
  });
});

describe('tsconfigFor', () => {
  const tree = (paths: string[]) => {
    const set = new Set(paths.map((p) => join(ROOT, p)));
    return (p: string) => set.has(p);
  };

  it('prefers the leaf app config over the solution-style root config', () => {
    const exists = tree([
      'apps/api/tsconfig.json',
      'apps/api/tsconfig.app.json',
      'apps/api/tsconfig.spec.json',
    ]);
    expect(tsconfigFor('apps/api/src/orders/orders.service.ts', { exists, root: ROOT })).toBe(
      'apps/api/tsconfig.app.json',
    );
  });

  it('sends a spec file to the spec config, which is the one that has the test types', () => {
    const exists = tree([
      'apps/api/tsconfig.json',
      'apps/api/tsconfig.app.json',
      'apps/api/tsconfig.spec.json',
    ]);
    expect(tsconfigFor('apps/api/src/orders/orders.service.spec.ts', { exists, root: ROOT })).toBe(
      'apps/api/tsconfig.spec.json',
    );
  });

  it('uses the lib config for a library', () => {
    const exists = tree(['libs/admin-ui/tsconfig.json', 'libs/admin-ui/tsconfig.lib.json']);
    expect(tsconfigFor('libs/admin-ui/src/button.ts', { exists, root: ROOT })).toBe(
      'libs/admin-ui/tsconfig.lib.json',
    );
  });

  it('falls back to the only config a project has', () => {
    const exists = tree(['tools/guards/tsconfig.json']);
    expect(tsconfigFor('tools/guards/src/secrets.spec.ts', { exists, root: ROOT })).toBe(
      'tools/guards/tsconfig.json',
    );
  });

  it('returns null when no project owns the file, so nothing is compiled by accident', () => {
    expect(tsconfigFor('scripts/one-off.ts', { exists: () => false, root: ROOT })).toBeNull();
  });
});

describe('filterDiagnostics', () => {
  const raw = [
    'apps/api/src/a.ts(3,10): error TS2322: Type string is not assignable to type number.',
    'apps/api/src/untouched.ts(9,1): error TS2554: Expected 1 arguments, but got 2.',
    'Found 2 errors.',
  ].join('\n');

  it('keeps only the diagnostics of the files the session touched', () => {
    const out = filterDiagnostics(raw, ['apps/api/src/a.ts']);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('TS2322');
  });

  it('matches a diagnostic printed with Windows separators', () => {
    const windows = 'apps\\api\\src\\a.ts(3,10): error TS2322: nope.';
    expect(filterDiagnostics(windows, ['apps/api/src/a.ts'])).toHaveLength(1);
  });

  it('caps one file and says so rather than dropping the rest in silence', () => {
    const noisy = Array.from(
      { length: MAX_LINES_PER_FILE + 6 },
      (_, i) => `apps/api/src/a.ts(${i + 1},1): error TS2322: nope.`,
    ).join('\n');

    const out = filterDiagnostics(noisy, ['apps/api/src/a.ts']);

    expect(out).toHaveLength(MAX_LINES_PER_FILE + 1);
    expect(out[MAX_LINES_PER_FILE]).toContain('suppressed');
  });

  it('returns nothing on a clean run', () => {
    expect(filterDiagnostics('', ['apps/api/src/a.ts'])).toEqual([]);
  });
});
