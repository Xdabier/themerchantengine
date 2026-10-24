/**
 * compact-nudge.mjs - the logic behind .claude/hooks/compact-nudge.sh.
 *
 * PreToolUse on every tool. Counts the tool calls of a session and reads the
 * context size from the last usage line of the transcript. At CALLS_FIRST calls
 * or TOKENS_LIMIT tokens it returns a non-blocking additionalContext line that
 * names the phase boundary, then repeats it every CALLS_EVERY calls. Nothing is
 * printed otherwise, so the hook costs zero context on a quiet call.
 *
 * Usage: node scripts/compact-nudge.mjs           (JSON event on stdin)
 *        node scripts/compact-nudge.mjs --reset   (SessionStart compact: drop the counter)
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CALLS_FIRST = 50;
export const CALLS_EVERY = 25;
export const TOKENS_LIMIT = 100_000;
// A transcript line with a long tool result can run to hundreds of kilobytes, so
// the tail has to be wide enough to reach back past one of those.
export const TAIL_BYTES = 512 * 1024;

// The hook can run from any cwd, so the state lives under the repo root: the
// directory Claude Code hands over, or failing that the parent of scripts/.
const REPO_ROOT =
  process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(REPO_ROOT, 'dist', '.compact-nudge');

// A subagent shares the parent's session_id but carries an agent_id, and its
// transcript sits under <session>/subagents/agent-<id>.jsonl. Counting those
// calls would inflate the parent's counter and nudge a subagent that cannot act.
export function isSubagentEvent(event) {
  if (typeof event?.agent_id === 'string') return true;
  const path = String(event?.transcript_path ?? '').replace(/\\/g, '/');
  return path.includes('/subagents/') || basename(path).startsWith('agent-');
}

export function parseEvent(raw) {
  try {
    const event = JSON.parse(raw);
    const sessionId = event?.session_id;
    const transcriptPath = event?.transcript_path;
    if (typeof sessionId !== 'string' || typeof transcriptPath !== 'string') return null;
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return null;
    // "." and ".." pass the character class but name a directory, not a state file.
    if (sessionId.replace(/[.]/g, '') === '') return null;
    if (isSubagentEvent(event)) return null;
    return { sessionId, transcriptPath };
  } catch {
    return null;
  }
}

export function contextTokensFromTail(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];
    if (!l.includes('"usage"')) continue;
    try {
      const usage = JSON.parse(l)?.message?.usage;
      if (usage && typeof usage.input_tokens === 'number') {
        return (
          usage.input_tokens +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0)
        );
      }
    } catch {
      // A byte-offset tail starts mid-line; skip it and keep walking back.
    }
  }
  return 0;
}

export function readTail(path, bytes = TAIL_BYTES) {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buffer, 0, length, start);
    } finally {
      closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

export function nextState(state, tokens) {
  const count = state.count + 1;
  const due = count >= CALLS_FIRST || tokens >= TOKENS_LIMIT;
  const spaced = state.lastNudge === 0 || count - state.lastNudge >= CALLS_EVERY;
  if (due && spaced) return { state: { count, lastNudge: count }, nudge: true };
  return { state: { count, lastNudge: state.lastNudge }, nudge: false };
}

export function nudgeMessage(count, tokens) {
  const k = Math.round(tokens / 1000);
  return (
    `Phase boundary: ${count} tool calls, context about ${k}k tokens. ` +
    'Write the current state to tasks.md (open tasks, failing test names, decisions), ' +
    'commit, then /compact or /clear before continuing.'
  );
}

function readState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed.count === 'number' && typeof parsed.lastNudge === 'number') return parsed;
  } catch {
    // First call of the session, or a state file another process is writing.
  }
  return { count: 0, lastNudge: 0 };
}

export function run(raw, options = {}) {
  const event = parseEvent(raw);
  if (!event) return '';
  const stateDir = options.stateDir ?? STATE_DIR;
  try {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    const file = join(stateDir, `${event.sessionId}.json`);
    const tokens = contextTokensFromTail(readTail(event.transcriptPath));
    const step = nextState(readState(file), tokens);
    writeFileSync(file, JSON.stringify(step.state));
    if (!step.nudge) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: nudgeMessage(step.state.count, tokens),
      },
    });
  } catch {
    return '';
  }
}

/**
 * Drop the counter for the session in the event. The SessionStart compact hook
 * calls this: the count and the token estimate belonged to the window that was
 * just compacted, so carrying them over would nudge again on the first call.
 * Never throws; a bad payload, a subagent event or a missing file is a no-op.
 */
export function resetState(raw, options = {}) {
  const event = parseEvent(raw);
  if (!event) return;
  const stateDir = options.stateDir ?? STATE_DIR;
  try {
    rmSync(join(stateDir, event.sessionId + '.json'), { force: true });
  } catch {
    // Nothing to reset, or the directory is not writable: the hook stays silent.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  if (process.argv.includes('--reset')) {
    resetState(raw);
  } else {
    const out = run(raw);
    if (out) process.stdout.write(out);
  }
  process.exit(0);
}
