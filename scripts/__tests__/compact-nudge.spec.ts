import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without a declaration file
import {
  CALLS_EVERY,
  CALLS_FIRST,
  TOKENS_LIMIT,
  contextTokensFromTail,
  isSubagentEvent,
  nextState,
  nudgeMessage,
  parseEvent,
  resetState,
  run,
} from '../compact-nudge.mjs';

// The hook exists so the window never fills unnoticed. The cases below are the
// ways that fails silently: a threshold that never fires, one that fires on every
// call and trains the model to ignore it, a transcript the hook cannot read, and
// a payload shape it does not expect.

const line = (usage: Record<string, number>, type = 'assistant') =>
  JSON.stringify({ type, message: { role: type, usage } });

describe('contextTokensFromTail', () => {
  it('sums input, cache read and cache creation of the last usage line', () => {
    const tail = [
      line({ input_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 1 }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } }),
      line({ input_tokens: 7, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 3 }),
    ].join('\n');
    expect(contextTokensFromTail(tail)).toBe(90_010);
  });

  it('skips a truncated first line, which is what a byte-offset tail produces', () => {
    const full = line({
      input_tokens: 1,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 0,
    });
    const tail = `ache_read_input_tokens": 999999}}}\n${full}`;
    expect(contextTokensFromTail(tail)).toBe(51);
  });

  it('returns zero when no usage line exists', () => {
    expect(contextTokensFromTail('')).toBe(0);
    expect(contextTokensFromTail('not json\n{"type":"user"}')).toBe(0);
  });
});

describe('nextState', () => {
  const start = { count: 0, lastNudge: 0 };

  it('stays quiet below both thresholds', () => {
    let state = start;
    for (let i = 1; i < CALLS_FIRST; i += 1) {
      const step = nextState(state, 1_000);
      expect(step.nudge).toBe(false);
      state = step.state;
    }
    expect(state.count).toBe(CALLS_FIRST - 1);
  });

  it('fires at the call threshold, then only every CALLS_EVERY calls', () => {
    let state = { count: CALLS_FIRST - 1, lastNudge: 0 };
    const fired: number[] = [];
    for (let i = 0; i < CALLS_EVERY * 2 + 1; i += 1) {
      const step = nextState(state, 1_000);
      if (step.nudge) fired.push(step.state.count);
      state = step.state;
    }
    expect(fired).toEqual([CALLS_FIRST, CALLS_FIRST + CALLS_EVERY, CALLS_FIRST + CALLS_EVERY * 2]);
  });

  it('fires on the token threshold alone, early in the session', () => {
    const step = nextState({ count: 2, lastNudge: 0 }, TOKENS_LIMIT);
    expect(step.nudge).toBe(true);
    expect(step.state).toEqual({ count: 3, lastNudge: 3 });
  });

  it('does not repeat a token nudge until CALLS_EVERY more calls have passed', () => {
    let state = { count: 3, lastNudge: 3 };
    for (let i = 0; i < CALLS_EVERY - 1; i += 1) {
      const step = nextState(state, TOKENS_LIMIT * 2);
      expect(step.nudge).toBe(false);
      state = step.state;
    }
    expect(nextState(state, TOKENS_LIMIT * 2).nudge).toBe(true);
  });
});

describe('nudgeMessage', () => {
  it('names the count, the tokens and both exits', () => {
    const text = nudgeMessage(75, 130_000);
    expect(text).toContain('75');
    expect(text).toContain('130k');
    expect(text).toMatch(/\/compact/);
    expect(text).toMatch(/\/clear/);
    expect(text).toMatch(/tasks\.md/);
  });
});

describe('parseEvent', () => {
  it('reads the session id and transcript path from the event', () => {
    expect(
      parseEvent(JSON.stringify({ session_id: 's1', transcript_path: '/t/s1.jsonl' })),
    ).toEqual({
      sessionId: 's1',
      transcriptPath: '/t/s1.jsonl',
    });
  });

  it('returns null rather than throwing on an unreadable payload', () => {
    expect(parseEvent('')).toBeNull();
    expect(parseEvent('not json')).toBeNull();
    expect(parseEvent(JSON.stringify({ tool_name: 'Bash' }))).toBeNull();
  });

  it('refuses a session id that could escape the state directory', () => {
    expect(parseEvent(JSON.stringify({ session_id: '../x', transcript_path: '/t' }))).toBeNull();
  });

  it('a dot-only session id is rejected', () => {
    // "." and ".." pass the character class but name a directory, not a state file.
    for (const id of ['.', '..', '...']) {
      expect(parseEvent(JSON.stringify({ session_id: id, transcript_path: '/t' }))).toBeNull();
    }
  });

  it('ignores a subagent event by its agent_id, its subagents folder or its agent- basename', () => {
    expect(
      parseEvent(
        JSON.stringify({ session_id: 's1', transcript_path: '/t/s1.jsonl', agent_id: 'a1' }),
      ),
    ).toBeNull();
    expect(
      parseEvent(
        JSON.stringify({ session_id: 's1', transcript_path: '/t/s1/subagents/agent-a1.jsonl' }),
      ),
    ).toBeNull();
    expect(
      parseEvent(
        JSON.stringify({
          session_id: 's1',
          transcript_path: 'C:\\t\\s1\\subagents\\agent-a1.jsonl',
        }),
      ),
    ).toBeNull();
    expect(
      parseEvent(JSON.stringify({ session_id: 's1', transcript_path: '/t/agent-a1.jsonl' })),
    ).toBeNull();
    expect(isSubagentEvent({ session_id: 's1', transcript_path: '/t/s1.jsonl' })).toBe(false);
  });
});

describe('run', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'compact-nudge-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const event = (transcriptPath: string) =>
    JSON.stringify({ session_id: 'sess', transcript_path: transcriptPath, tool_name: 'Read' });

  it('prints nothing until a threshold is reached, then the hook JSON once', () => {
    const transcript = join(dir, 't.jsonl');
    writeFileSync(
      transcript,
      line({ input_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }),
    );
    const outputs: string[] = [];
    for (let i = 0; i < CALLS_FIRST + 1; i += 1)
      outputs.push(run(event(transcript), { stateDir: dir }));
    expect(outputs.slice(0, CALLS_FIRST - 1).every((o) => o === '')).toBe(true);
    const parsed = JSON.parse(outputs[CALLS_FIRST - 1]);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.additionalContext).toContain(String(CALLS_FIRST));
    expect(outputs[CALLS_FIRST]).toBe('');
  });

  it('nudges on the first call when the transcript already shows a full window', () => {
    const transcript = join(dir, 't.jsonl');
    writeFileSync(
      transcript,
      line({
        input_tokens: 5,
        cache_read_input_tokens: TOKENS_LIMIT,
        cache_creation_input_tokens: 0,
      }),
    );
    const out = run(event(transcript), { stateDir: dir });
    expect(out).not.toBe('');
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain('100k');
  });

  it('does not let a subagent advance the parent counter or receive the nudge', () => {
    const transcript = join(dir, 't.jsonl');
    writeFileSync(
      transcript,
      line({ input_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }),
    );
    const subagent = JSON.stringify({
      session_id: 'sess',
      transcript_path: join(dir, 'subagents', 'agent-a1.jsonl'),
      agent_id: 'a1',
      tool_name: 'Read',
    });
    for (let i = 0; i < CALLS_FIRST; i += 1) expect(run(subagent, { stateDir: dir })).toBe('');
    // The parent starts from zero: the nudge still needs its own CALLS_FIRST calls.
    const outputs: string[] = [];
    for (let i = 0; i < CALLS_FIRST; i += 1)
      outputs.push(run(event(transcript), { stateDir: dir }));
    expect(outputs.slice(0, CALLS_FIRST - 1).every((o) => o === '')).toBe(true);
    expect(outputs[CALLS_FIRST - 1]).not.toBe('');
  });

  it('a compaction resets the counter', () => {
    const transcript = join(dir, 't.jsonl');
    writeFileSync(
      transcript,
      line({ input_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }),
    );
    for (let i = 0; i < CALLS_FIRST - 1; i += 1) run(event(transcript), { stateDir: dir });
    resetState(event(transcript), { stateDir: dir });
    // The window is empty again, so the nudge needs its full CALLS_FIRST calls.
    const outputs: string[] = [];
    for (let i = 0; i < CALLS_FIRST; i += 1)
      outputs.push(run(event(transcript), { stateDir: dir }));
    expect(outputs.slice(0, CALLS_FIRST - 1).every((o) => o === '')).toBe(true);
    expect(outputs[CALLS_FIRST - 1]).not.toBe('');
    // A reset with no state, a bad payload or a subagent event is a no-op.
    expect(() => resetState(event(transcript), { stateDir: dir })).not.toThrow();
    expect(() => resetState('garbage', { stateDir: dir })).not.toThrow();
  });

  it('still counts calls when the transcript is missing, and never throws', () => {
    const outputs: string[] = [];
    for (let i = 0; i < CALLS_FIRST; i += 1)
      outputs.push(run(event(join(dir, 'missing.jsonl')), { stateDir: dir }));
    expect(outputs[CALLS_FIRST - 1]).not.toBe('');
    expect(run('garbage', { stateDir: dir })).toBe('');
  });
});
