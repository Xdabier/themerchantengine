/**
 * The public tree is a `git archive` that export-ignores `.claude/`. A shim
 * installed there would exec a missing script, exit 127 and reject every
 * commit and push a contributor makes.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const INSTALLER = path.resolve(__dirname, '..', 'install-git-hooks.mjs');
const HOOKS = ['pre-commit', 'pre-push'];

// The installer is copied into `shipped`; `cwd` is where it runs. Each tree
// gets .claude/hooks only when asked.
function install(opts: {
  shippedHasHooks: boolean;
  cwdHasHooks?: boolean;
  separateCwd?: boolean;
}): { status: number | null; shims: boolean[] } {
  const shipped = mkdtempSync(path.join(tmpdir(), 'hook-tree-'));
  const cwd = opts.separateCwd ? mkdtempSync(path.join(tmpdir(), 'hook-cwd-')) : shipped;
  try {
    mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
    mkdirSync(path.join(shipped, 'scripts'));
    if (opts.shippedHasHooks)
      mkdirSync(path.join(shipped, '.claude', 'hooks'), { recursive: true });
    if (opts.cwdHasHooks) mkdirSync(path.join(cwd, '.claude', 'hooks'), { recursive: true });
    const script = path.join(shipped, 'scripts', 'install-git-hooks.mjs');
    copyFileSync(INSTALLER, script);
    const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    return {
      status: result.status,
      shims: HOOKS.map((name) => existsSync(path.join(cwd, '.git', 'hooks', name))),
    };
  } finally {
    rmSync(shipped, { recursive: true, force: true });
    if (cwd !== shipped) rmSync(cwd, { recursive: true, force: true });
  }
}

it('writes no shim when the tree it ships in carries no .claude/hooks', () => {
  expect(install({ shippedHasHooks: false })).toEqual({ status: 0, shims: [false, false] });
});

it('still writes both shims in a tree that carries .claude/hooks', () => {
  expect(install({ shippedHasHooks: true })).toEqual({ status: 0, shims: [true, true] });
});

it('reads its own tree, not the working directory, to decide', () => {
  expect(install({ shippedHasHooks: false, cwdHasHooks: true, separateCwd: true })).toEqual({
    status: 0,
    shims: [false, false],
  });
});
