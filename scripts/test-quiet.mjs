#!/usr/bin/env node
/**
 * Quiet wrapper around the repository's test runners.
 *
 * Phase O3. A session ran 34 unit suites and 11 Playwright suites, and every one
 * of them poured its full reporter into the model's context: thousands of PASS
 * lines to find the two that said FAIL. This wrapper runs the same command,
 * writes the unfiltered output to `dist/test-logs/<timestamp>.log`, and prints
 * only the failing test names, the first lines of each failure and the totals.
 *
 * Two invariants hold it honest, and `scripts/__tests__/test-quiet.spec.ts`
 * turns red if either breaks: a failure is never silently swallowed (past the
 * block budget the remaining tests are still named, and a red run that parses
 * into nothing falls back to the raw tail), and the path to the unfiltered log
 * is always printed, exactly once.
 *
 *   node scripts/test-quiet.mjs test <project> [--testFile <pattern>] [...]
 *   node scripts/test-quiet.mjs e2e  <project> [--grep <pattern>] [...]
 *   node scripts/test-quiet.mjs raw -- <command> [...]
 *   node scripts/test-quiet.mjs --hook        (PreToolUse rewrite, reads JSON on stdin)
 *
 * Wired as `npm run t` and `npm run t:e2e`.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '..');

export const MAX_BLOCK_LINES = 40;
// One failure in full, every other failure by name. The plan asks for 40 lines of
// detail per failure and for a run to stay under 60 lines of output; those two
// numbers only hold together at one detailed block. Nothing is hidden either way:
// the rest are named and the unfiltered log is one line below them.
export const MAX_BLOCKS = 1;
export const WRAPPER = 'node scripts/test-quiet.mjs';

const USAGE =
  'usage: node scripts/test-quiet.mjs test|e2e <project> [args] | raw -- <command> [args]';

export function buildCommand(args) {
  const [kind, ...rest] = args;

  if (kind === 'raw') {
    const command = rest[0] === '--' ? rest.slice(1) : rest;
    if (command.length === 0) throw new Error(USAGE);
    return { kind: 'raw', argv: command };
  }

  if (kind !== 'test' && kind !== 'e2e') throw new Error(USAGE);

  const project = rest[0];
  if (!project || project.startsWith('-')) throw new Error(USAGE);

  const argv = ['nx', kind, project];
  for (let i = 1; i < rest.length; i += 1) {
    // Jest reads a path pattern, not a file; `--testFile` is the intent the plan
    // names, so translate it rather than make every caller remember the flag.
    if (rest[i] === '--testFile' && rest[i + 1]) {
      argv.push(`--testPathPattern=${rest[i + 1]}`);
      i += 1;
      continue;
    }
    argv.push(rest[i]);
  }
  return { kind, argv };
}

const isJestFailureHeader = (line) => /^\s*●(?!\s*Console)/.test(line);
const isPlaywrightFailureHeader = (line) => /^\s{0,6}\d+\)\s/.test(line);
const isTotals = (line) =>
  /^(Test Suites|Tests|Snapshots|Time):/.test(line) ||
  /^\s*\d+\s+(passed|failed|flaky|skipped|interrupted|did not run)\b/.test(line);
const isBlockHeader = (line) => isJestFailureHeader(line) || isPlaywrightFailureHeader(line);
const endsBlock = (line) => isBlockHeader(line) || isTotals(line) || /^(PASS|FAIL)\s/.test(line);

function collectBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isBlockHeader(lines[i])) continue;
    const body = [lines[i]];
    let j = i + 1;
    while (j < lines.length && !endsBlock(lines[j])) {
      body.push(lines[j]);
      j += 1;
    }
    blocks.push({ name: lines[i].trim(), body });
    i = j - 1;
  }
  return blocks;
}

// Nx, Jest and Playwright all colour their reporters, and the escape codes sit
// between the start of the line and the word the parser matches on. The log file
// keeps the raw bytes; the parser and the printed summary see plain text.
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

export function summarize(raw, { logPath, exitCode = 0 } = {}) {
  const lines = String(raw).replace(ANSI, '').replace(/\r\n/g, '\n').split('\n');
  const blocks = collectBlocks(lines);
  const totals = lines.filter(isTotals).filter((line) => !isBlockHeader(line));
  const out = [];

  blocks.slice(0, MAX_BLOCKS).forEach((block) => {
    const body =
      block.body.length > MAX_BLOCK_LINES
        ? [
            ...block.body.slice(0, MAX_BLOCK_LINES),
            `    ... truncated, ${block.body.length - MAX_BLOCK_LINES} more lines in the log`,
          ]
        : block.body;
    out.push(...body, '');
  });

  const overflow = blocks.slice(MAX_BLOCKS);
  if (overflow.length > 0) {
    out.push(`${overflow.length} more failing test${overflow.length === 1 ? '' : 's'}:`);
    overflow.forEach((block) => out.push(`  ${block.name}`));
    out.push('');
  }

  if (totals.length > 0) out.push(...totals.map((line) => line.trimEnd()));

  // A red run that parsed into nothing is the case where filtering would do real
  // harm: the runner crashed before it produced a summary. Show the tail instead.
  if (blocks.length === 0 && totals.length === 0) {
    const tail = lines.filter((line) => line.trim() !== '').slice(-MAX_BLOCK_LINES);
    out.push(...(exitCode === 0 ? ['no test summary found in the output'] : tail));
  }

  out.push('', `full log: ${logPath}`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

const SKIP_REWRITE = [
  /test-quiet/,
  /--coverage\b/,
  /\bnx\s+affected\b/,
  /\brun-many\b/,
  /^npm\s+run\b/,
];

// The hook that calls this answers `permissionDecision: "allow"`, and a decision
// applies to the whole tool call rather than to the part that was rewritten. So a
// command that could carry a second command past that approval is not rewritten at
// all: chaining, a pipeline, a background `&`, a redirect, a command substitution
// or a newline. `npx nx test admin && curl … | sh` would otherwise have its first
// segment matched and the rest waved through, which is exactly what the permission
// prompt exists to catch. A refused command still runs; it just runs loud.
const COMPOUND = /[\n|&;`<>]|\$\(/;

export function rewriteTestCommand(command) {
  const whole = String(command).trim();
  if (whole === '' || COMPOUND.test(whole)) return null;
  if (SKIP_REWRITE.some((rx) => rx.test(whole))) return null;

  const nx = whole.match(/^npx\s+nx\s+(test|e2e)\s+(\S+)(.*)$/);
  if (nx) return `${WRAPPER} ${nx[1]} ${nx[2]}${nx[3]}`;
  if (/^npx\s+(jest|playwright)\b/.test(whole)) return `${WRAPPER} raw -- ${whole}`;
  return null;
}

// `spawn(bin, argv, { shell: true })` joins the arguments with spaces and quotes
// nothing, so `-t "renders the cart"` reaches the runner as three arguments and
// matches no tests. Build the command line here instead, quoting every argument
// that the shell would otherwise split or interpret.
export function shellCommand(argv) {
  return argv
    .map((arg) => {
      const value = String(arg);
      if (value !== '' && !/[\s"'`$&|;<>()*?!{}[\]~#\\]/.test(value)) return value;
      return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
    })
    .join(' ');
}

function readHookInput() {
  const fromEnv = process.env['CLAUDE_TOOL_INPUT'];
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function runHook() {
  let payload = {};
  try {
    payload = JSON.parse(readHookInput() || '{}');
  } catch {
    return 0;
  }

  const toolInput = payload?.tool_input ?? payload ?? {};
  const updated = rewriteTestCommand(toolInput.command ?? '');
  if (!updated) return 0;

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'routed through the quiet test wrapper (phase O3)',
        updatedInput: { ...toolInput, command: updated },
      },
    })}\n`,
  );
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--hook') process.exit(runHook());

  let plan;
  try {
    plan = buildCommand(args);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = `dist/test-logs/${stamp}.log`;
  const logFile = resolve(WORKSPACE_ROOT, logPath);
  mkdirSync(dirname(logFile), { recursive: true });

  const command = shellCommand(plan.kind === 'raw' ? plan.argv : ['npx', ...plan.argv]);
  const child = spawn(command, { cwd: WORKSPACE_ROOT, shell: true });

  let raw = '';
  child.stdout.on('data', (chunk) => (raw += chunk));
  child.stderr.on('data', (chunk) => (raw += chunk));

  // 'close', not 'exit': 'exit' can fire before the pipes have drained, and the
  // tail is exactly where the runner prints its totals. Losing it would both hide
  // a failure and truncate the log this wrapper offers as the way back to it.
  const code = await new Promise((done) =>
    child.on('close', (c, signal) => done(signal ? 1 : (c ?? 0))),
  );
  writeFileSync(logFile, raw, 'utf8');
  console.log(summarize(raw, { logPath, exitCode: code }));
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
