#!/usr/bin/env node
/**
 * Batched type check for the edits the language server never sees.
 *
 * Phase O3. The `typescript-lsp` plugin reports diagnostics after the `Edit` and
 * `Write` tools, which is where most type errors now die. It does not see a file
 * rewritten through a Bash heredoc, a `sed` call or a generator script, and this
 * repository writes files that way whenever an escape sequence would be mangled.
 *
 * So: a `PostToolUse` hook on Bash queues any repository TypeScript path the
 * command named, and a `Stop` hook resolves each queued file to its nearest leaf
 * tsconfig, runs one `tsc --noEmit` per project, and reports only the
 * diagnostics that belong to the queued files, at most ten lines each. A whole
 * project's pre-existing errors are not this hook's business; the files the
 * session just touched are.
 *
 *   node scripts/typecheck-batch.mjs --queue   (PostToolUse on Bash, JSON on stdin)
 *   node scripts/typecheck-batch.mjs --run     (Stop, JSON on stdin)
 *
 * Set TYPECHECK_HOOK=0 to turn both halves off.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '..');
const QUEUE = join(WORKSPACE_ROOT, 'dist', '.typecheck', 'queue.txt');
const TSC = join(WORKSPACE_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

export const MAX_LINES_PER_FILE = 10;
export const SOURCE_ROOTS = ['apps', 'libs', 'tools', 'scripts', 'prisma', 'test'];

const slash = (p) => String(p).replace(/[\\/]+/g, '/');

// `CLAUDE_TOOL_INPUT` carries the tool input on its own; stdin carries the whole
// event with the input nested. Read either, or the queue quietly stays empty and
// the fallback is a no-op that looks exactly like a clean tree.
function commandOf(payload) {
  try {
    const parsed = JSON.parse(payload || '{}');
    return parsed?.tool_input?.command ?? parsed?.command ?? '';
  } catch {
    return '';
  }
}

// A path that climbs out of the workspace would point the compiler at a project
// nobody here wrote. The queue is a file on disk, so this is also the check that
// re-runs on read: anything that reaches `run()` has passed it twice.
export const isRepoPath = (p) =>
  new RegExp(`^(?:${SOURCE_ROOTS.join('|')})/[\\w./-]+\\.tsx?$`).test(p) &&
  !p.split('/').includes('..');

export function collectPaths(payload) {
  const rx = new RegExp(`(?:${SOURCE_ROOTS.join('|')})[\\\\/][\\w./\\\\-]+\\.tsx?`, 'g');
  return [...new Set((commandOf(payload).match(rx) ?? []).map(slash))].filter(isRepoPath);
}

// Queue what a command wrote, not what it mentioned. Without this a `cat` or a
// `git diff` spends a whole project `tsc` at the end of the turn and hands back
// pre-existing errors in a file the session only read.
export function isWriteShaped(payload) {
  const command = commandOf(payload);
  if (command === '') return false;
  return (
    // A redirection into a file, not a file-descriptor dup: `2>&1` and
    // `2>/dev/null` decorate a read as often as a write.
    /(^|[^0-9&])>>?\s*[^&\s]/.test(command) ||
    /\btee\b/.test(command) ||
    /\bsed\b[^|]*\s-[a-zA-Z]*i\b/.test(command) ||
    /\b(cp|mv|install|rsync)\s/.test(command)
  );
}

// What a command WROTE, which is the redirect's target rather than every path the
// command line happens to contain. The distinction is the whole point: a heredoc
// that appends prose to a markdown file, quoting a TypeScript path inside that
// prose, writes the markdown and nothing else. Reading the paths instead of the
// targets made this hook report a project's pre-existing errors as though the
// session had just caused them.
export function writeTargets(payload) {
  const command = commandOf(payload);
  if (command === '') return [];
  const targets = new Set();
  const add = (value) => {
    if (value) targets.add(slash(value));
  };

  // `> file` and `>> file`, but never a file-descriptor dup: `2>&1` and
  // `2>/dev/null` decorate a read at least as often as a write.
  for (const m of command.matchAll(/(?:^|[^0-9&])>>?\s*([^\s&|;<>]+)/g)) add(m[1]);
  for (const m of command.matchAll(/\btee\b(?:\s+-[a-zA-Z]+)*\s+([^\s&|;<>]+)/g)) add(m[1]);
  for (const m of command.matchAll(/\bsed\s+-[a-zA-Z]*i[a-zA-Z]*\s+\S+\s+([^\s&|;<>]+)/g))
    add(m[1]);
  // The destination of a copy or a move is what changed; the source did not.
  for (const m of command.matchAll(
    /\b(?:cp|mv|install|rsync)\s+(?:-[a-zA-Z]+\s+)*\S+\s+([^\s&|;<>]+)/g,
  )) {
    add(m[1]);
  }

  return [...targets].filter(isRepoPath);
}

// The Nx root tsconfig.json of a project is a solution file: it lists references
// and includes nothing, so pointing tsc at it compiles zero files and reports a
// clean tree. The leaf config is the one that has the sources.
export function tsconfigFor(file, { exists = existsSync, root = WORKSPACE_ROOT } = {}) {
  const isSpec = /\.spec\.tsx?$/.test(file);
  let dir = dirname(slash(file));

  while (dir && dir !== '.' && dir !== '/') {
    const at = (name) => `${dir}/${name}`;
    if (exists(join(root, at('tsconfig.json')))) {
      for (const candidate of [
        ...(isSpec ? ['tsconfig.spec.json'] : []),
        'tsconfig.app.json',
        'tsconfig.lib.json',
        'tsconfig.json',
      ]) {
        if (exists(join(root, at(candidate)))) return at(candidate);
      }
    }
    const next = dir.slice(0, dir.lastIndexOf('/'));
    if (next === dir) break;
    dir = next;
  }
  return null;
}

export function filterDiagnostics(raw, files, { maxPerFile = MAX_LINES_PER_FILE } = {}) {
  const wanted = new Set(files.map(slash));
  const seen = new Map();
  const out = [];

  for (const line of String(raw).replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s/);
    if (!match) continue;
    const file = slash(match[1]);
    if (!wanted.has(file)) continue;
    const count = seen.get(file) ?? 0;
    if (count === maxPerFile) {
      out.push(`${file}: more diagnostics suppressed, run tsc on the project to see them all`);
    }
    if (count >= maxPerFile) {
      seen.set(file, count + 1);
      continue;
    }
    seen.set(file, count + 1);
    out.push(line.trimEnd());
  }
  return out;
}

function readStdin() {
  const fromEnv = process.env['CLAUDE_TOOL_INPUT'];
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function queue(payload) {
  const paths = writeTargets(payload).filter((p) => existsSync(join(WORKSPACE_ROOT, p)));
  if (paths.length === 0) return 0;
  mkdirSync(dirname(QUEUE), { recursive: true });
  appendFileSync(QUEUE, `${paths.join('\n')}\n`, 'utf8');
  return 0;
}

function run(payload) {
  if (!existsSync(QUEUE)) return 0;
  // Re-validate on read. The queue is a file under dist/, so anything that can
  // append to it would otherwise choose the argument this hook hands a compiler.
  const files = [...new Set(readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean))]
    .filter(isRepoPath)
    .filter((p) => existsSync(join(WORKSPACE_ROOT, p)));
  rmSync(QUEUE, { force: true });
  if (files.length === 0) return 0;

  // The Stop hook fires again on the turn it opened. Report once and let the
  // session end rather than hold it in a loop it cannot break out of.
  try {
    if (JSON.parse(payload || '{}')?.stop_hook_active) return 0;
  } catch {
    /* an unreadable payload is not a reason to skip the check */
  }

  const byConfig = new Map();
  for (const file of files) {
    const config = tsconfigFor(file);
    if (!config) continue;
    byConfig.set(config, [...(byConfig.get(config) ?? []), file]);
  }

  const findings = [];
  for (const [config, owned] of byConfig) {
    // No `shell: true`: it would rejoin the argument vector into one string and
    // let a shell re-parse it, which turns the tsconfig path into a place a second
    // command can hide. Not `npx` either, because Node refuses to spawn a .cmd
    // shim without a shell and the refusal is silent here. Run the compiler's own
    // entry point on this Node.
    const result = spawnSync(process.execPath, [TSC, '-p', config, '--noEmit'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      timeout: 240_000,
    });
    if (result.error) {
      findings.push(`could not run tsc on ${config}: ${result.error.message}`);
      continue;
    }
    findings.push(...filterDiagnostics(`${result.stdout ?? ''}${result.stderr ?? ''}`, owned));
  }

  if (findings.length === 0) return 0;
  process.stderr.write(
    `Type errors in files this session edited through Bash (the LSP does not see those):\n${findings.join('\n')}\n`,
  );
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env['TYPECHECK_HOOK'] === '0') process.exit(0);
  const payload = readStdin();
  process.exit(process.argv[2] === '--run' ? run(payload) : queue(payload));
}
