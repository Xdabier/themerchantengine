#!/usr/bin/env node
// Installs the pre-commit and pre-push shims so .claude/hooks/*.sh run in every
// clone. Runs from npm's prepare script. Skips silently without a .git
// directory (Docker builds, tarballs). The shims live in .git/hooks, git's
// default hooks dir, and the git-hooks guard keeps core.hooksPath unset: a
// value there would move the hooks away from the shims.
//
// Both gates existed only as Claude Code hooks before phase O2. That made them
// gates on what Claude does, not gates on what lands: a commit typed in a
// terminal skipped them entirely, and the Claude hook itself only loads at
// session start. The shims make them real for everyone.
//
// A hook this script did not write is left alone, but the run exits 1 and
// names it: with a foreign hook in place the gate does not run in this clone,
// and a silent skip would hide that until the guard suite runs. Remove or
// move the file and run `node scripts/install-git-hooks.mjs` again.
//
// The public tree export-ignores `.claude/`, so its hook scripts are absent
// there. A shim would exec a missing script and reject every commit, so the
// run installs nothing when the tree this script ships in carries no
// .claude/hooks.

import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shippedTree = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(shippedTree, '.claude', 'hooks'))) process.exit(0);

const root = process.cwd();
const gitDir = join(root, '.git');
if (!existsSync(gitDir) || !existsSync(join(gitDir, 'hooks'))) process.exit(0);

const HOOKS = ['pre-commit', 'pre-push'];
let foreign = 0;

for (const name of HOOKS) {
  const shim = join(gitDir, 'hooks', name);
  const body = `#!/bin/sh\nexec bash .claude/hooks/${name}.sh "$@"\n`;
  if (existsSync(shim) && readFileSync(shim, 'utf8') === body) continue;
  if (existsSync(shim)) {
    console.error(`install-git-hooks: ${shim} exists and is not ours, leaving it alone`);
    foreign += 1;
    continue;
  }
  writeFileSync(shim, body);
  chmodSync(shim, 0o755);
  console.log(`install-git-hooks: ${name} shim installed`);
}

if (foreign > 0) {
  console.error('install-git-hooks: remove or move the foreign hook and run this script again');
  process.exit(1);
}
