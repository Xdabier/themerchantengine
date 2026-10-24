// Proves the fresh-clone path (plan E4.2): the stepper builds from its own
// lockfile with the workspace node_modules absent, and the bundle runs.
//
//   node tools/setup/verify-standalone.mjs
//
// Copies only what the wrappers rely on into a temporary directory (the
// stepper package, the shared library sources it imports, the root
// package.json for the version), runs `npm ci` there, builds, and runs the
// bundle's --version. The setup-standalone job in .github/workflows/ci.yml
// runs it on every push.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..', '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-standalone-'));

const copy = (relative) => {
  const from = path.join(workspace, relative);
  const to = path.join(scratch, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.includes(`${path.sep}dist`),
  });
};
copy('package.json');
copy('tsconfig.base.json');
copy('tools/setup');
copy('libs/shared/common/src');
copy('scripts/verify-no-client-refs.ts');
// Repository-only: a release tarball has no token table.
if (fs.existsSync(path.join(workspace, 'scripts/verify-no-client-refs.tokens.json')))
  copy('scripts/verify-no-client-refs.tokens.json');

const run = (cmd, args, cwd) => {
  process.stdout.write(`$ ${cmd} ${args.join(' ')}  (in ${path.relative(scratch, cwd) || '.'})\n`);
  return execFileSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
};

try {
  if (fs.existsSync(path.join(scratch, 'node_modules')))
    throw new Error('the scratch copy must have no workspace node_modules');
  run(
    'npm',
    ['ci', '--no-audit', '--no-fund', '--loglevel=error'],
    path.join(scratch, 'tools', 'setup'),
  );
  run('node', ['tools/setup/build.mjs'], scratch);
  const version = run('node', ['tools/setup/dist/index.js', '--version'], scratch).trim();
  const expected = JSON.parse(
    fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'),
  ).version;
  if (version !== expected) throw new Error(`the bundle reports ${version}, expected ${expected}`);
  process.stdout.write(`standalone build ok: ${version}\n`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
