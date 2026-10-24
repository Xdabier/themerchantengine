import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs scripts/llm-metrics/baseline.py against a hand-built transcript tree and
// checks every number it prints. The fixture has known values, so a broken
// counter changes the output and the test goes red (canary: see the last test).

const SCRIPT = resolve(__dirname, '..', 'llm-metrics', 'baseline.py');
const PYTHON = process.env.PYTHON ?? 'python';

type Line = Record<string, unknown>;

function assistant(
  id: string,
  ts: string,
  input: number,
  output: number,
  toolUse?: { id: string; command: string },
): Line {
  const content: unknown[] = [{ type: 'text', text: 'ok' }];
  if (toolUse)
    content.push({
      type: 'tool_use',
      id: toolUse.id,
      name: 'Bash',
      input: { command: toolUse.command },
    });
  return {
    type: 'assistant',
    timestamp: ts,
    message: {
      id,
      usage: {
        input_tokens: input / 10,
        cache_read_input_tokens: (input * 9) / 10,
        cache_creation_input_tokens: 0,
        output_tokens: output,
      },
      content,
    },
  };
}

function toolResult(toolUseId: string, ts: string): Line {
  return {
    type: 'user',
    timestamp: ts,
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'done' }] },
  };
}

function jsonl(lines: Line[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function at(base: string, seconds: number): string {
  return new Date(Date.parse(base) + seconds * 1000).toISOString();
}

let root: string;
let specs: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'llm-metrics-'));
  specs = join(root, 'specs');
  mkdirSync(specs);

  const a = '2026-09-01T10:00:00.000Z';
  const m1 = assistant('m1', at(a, 0), 10_000, 100, { id: 'tu1', command: 'npx nx test api' });
  // A streamed response is written once per content block with the same id and usage.
  const m1dup = {
    ...m1,
    message: { ...(m1.message as object), content: [{ type: 'text', text: 'second block' }] },
  };
  writeFileSync(
    join(root, 'a1a1a1a1-0000-0000-0000-000000000000.jsonl'),
    jsonl([
      m1,
      m1dup,
      toolResult('tu1', at(a, 30)),
      assistant('m2', at(a, 40), 20_000, 200, {
        id: 'tu2',
        command: 'npx nx e2e admin-e2e --grep=orders',
      }),
      toolResult('tu2', at(a, 160)),
      // One compaction writes a boundary entry and a summary entry. It counts once.
      { type: 'system', subtype: 'compact_boundary', timestamp: at(a, 1800) },
      {
        type: 'user',
        isCompactSummary: true,
        timestamp: at(a, 1801),
        message: { content: 'summary' },
      },
      assistant('m3', at(a, 3600), 30_000, 300),
    ]),
  );

  const b = '2026-09-02T10:00:00.000Z';
  writeFileSync(
    join(root, 'b2b2b2b2-0000-0000-0000-000000000000.jsonl'),
    jsonl([
      assistant('m4', at(b, 0), 40_000, 400, { id: 'tu3', command: 'npx jest scripts' }),
      toolResult('tu3', at(b, 90)),
      assistant('m5', at(b, 7200), 50_000, 500),
    ]),
  );

  const sub = join(root, 'a1a1a1a1-0000-0000-0000-000000000000', 'subagents');
  mkdirSync(sub, { recursive: true });
  const m6 = assistant('m6', at(a, 5), 5_000, 50);
  writeFileSync(
    join(sub, 'agent-x.jsonl'),
    jsonl([m6, m6, assistant('m7', at(a, 10), 15_000, 60)]),
  );

  writeFileSync(
    join(specs, 'plan.md'),
    [
      '# Plan',
      '',
      '## Phase log',
      '',
      'X1 - done - abc..def - 2026-09-01 - all agents PASS - tokens in/out: 180k/12k',
      'X2 - done - abc..def - 2026-09-02 - all agents PASS - tokens in/out: historical-unknown',
      'X3 - a line without a token field',
      '',
      '## Not the log',
      '',
      'tokens in/out: 999k/1k must not be counted here',
      '',
    ].join('\n'),
  );

  // Some plans number their headings. The log section still counts.
  writeFileSync(
    join(specs, 'plan-numbered.md'),
    [
      '# Other plan',
      '',
      '## 7. Phase log',
      '',
      'Y1 - abc..def - 2026-09-03 - PASS - tokens in/out: historical-unknown',
      '',
    ].join('\n'),
  );

  // "current" means the most recently modified session file.
  const older = new Date('2026-09-01T12:00:00Z');
  const newer = new Date('2026-09-03T12:00:00Z');
  utimesSync(join(root, 'a1a1a1a1-0000-0000-0000-000000000000.jsonl'), older, older);
  utimesSync(join(root, 'b2b2b2b2-0000-0000-0000-000000000000.jsonl'), newer, newer);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  const r = spawnSync(PYTHON, [SCRIPT, '--root', root, '--specs', specs, ...args], {
    encoding: 'utf-8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('llm-metrics baseline', () => {
  it('prints the six baseline numbers from the fixture, deduped by message id', () => {
    const r = run(['--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.sessions).toBe(2);
    expect(j.ctx_median).toBe(30_000);
    expect(j.ctx_p90).toBe(50_000);
    expect(j.session_median_hours).toBe(1.5);
    expect(j.session_median_calls).toBe(2.5);
    expect(j.unit_runs_per_session).toBe(1);
    expect(j.unit_minutes_per_session).toBe(1);
    expect(j.e2e_runs_per_session).toBe(0.5);
    expect(j.e2e_minutes_per_session).toBe(1);
    expect(j.main_input_tokens).toBe(150_000);
    expect(j.subagent_input_tokens).toBe(20_000);
    expect(j.subagent_share_pct).toBe(11.8);
    expect(j.compactions).toBe(1);
    expect(j.phase_log_numeric).toBe(1);
    expect(j.phase_log_total).toBe(3);
  });

  it('prints one line per baseline number in the human format', () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('1. context per API call: median 30k, p90 50k');
    expect(r.out).toContain('2. session: median 1.5 h, median 2.5 API calls');
    expect(r.out).toContain(
      '3. tests per session: unit 1.0 runs / 1.0 min, e2e 0.5 runs / 1.0 min',
    );
    expect(r.out).toContain('4. subagent input tokens: 20k (11.8 percent of all input)');
    expect(r.out).toContain('5. compactions: 1 in 2 sessions');
    expect(r.out).toContain('6. phase-log lines with real token counts: 1 of 3');
  });

  it('reports tokens in/out for one session by id prefix and for the current session', () => {
    const byId = run(['--session', 'a1a1']);
    expect(byId.out).toContain('session a1a1a1a1: 1.0 h, 3 API calls, tokens in/out: 60k/600');
    const current = run(['--session', 'current']);
    expect(current.out).toContain('session b2b2b2b2: 2.0 h, 2 API calls, tokens in/out: 90k/900');
  });

  it('--since keeps only the sessions that started on or after the date, with their subagents', () => {
    const r = run(['--json', '--since', '2026-09-02']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.sessions).toBe(1);
    expect(j.since).toBe('2026-09-02');
    expect(j.ctx_median).toBe(45_000);
    expect(j.main_input_tokens).toBe(90_000);
    // The only subagent transcript belongs to the session of 2026-09-01, so it drops too.
    expect(j.subagent_input_tokens).toBe(0);
    expect(j.compactions).toBe(0);
    const human = run(['--since', '2026-09-02']);
    expect(human.out).toContain('sessions: 1 (since 2026-09-02)');
  });

  it('--since keeps the subagent transcripts of a kept session', () => {
    const kept = join(root, 'b2b2b2b2-0000-0000-0000-000000000000', 'subagents');
    mkdirSync(kept, { recursive: true });
    try {
      writeFileSync(
        join(kept, 'agent-y.jsonl'),
        jsonl([assistant('m8', '2026-09-02T10:00:05.000Z', 8_000, 80)]),
      );
      const j = JSON.parse(run(['--json', '--since', '2026-09-02']).out);
      expect(j.sessions).toBe(1);
      expect(j.subagent_input_tokens).toBe(8_000);
    } finally {
      rmSync(kept, { recursive: true, force: true });
    }
  });

  it('--since that leaves no session names the flag in the error', () => {
    const r = run(['--since', '2099-01-01']);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('--since 2099-01-01');
  });

  it('--since rejects a value that is not a calendar date', () => {
    const r = run(['--since', 'yesterday']);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('--since');
  });

  it('fails when the transcript root holds no session', () => {
    const empty = mkdtempSync(join(tmpdir(), 'llm-metrics-empty-'));
    try {
      const r = spawnSync(PYTHON, [SCRIPT, '--root', empty, '--specs', specs], {
        encoding: 'utf-8',
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('no sessions');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('counts a summary-only compaction once when the file has no boundary entry', () => {
    const other = mkdtempSync(join(tmpdir(), 'llm-metrics-summary-'));
    try {
      writeFileSync(
        join(other, 'd4d4d4d4-0000-0000-0000-000000000000.jsonl'),
        jsonl([
          assistant('m8', '2026-09-06T10:00:00.000Z', 1_000, 1),
          {
            type: 'user',
            isCompactSummary: true,
            timestamp: '2026-09-06T10:01:00.000Z',
            message: { content: 'summary' },
          },
        ]),
      );
      const r = spawnSync(PYTHON, [SCRIPT, '--root', other, '--specs', specs, '--json'], {
        encoding: 'utf-8',
      });
      expect(JSON.parse(r.stdout).compactions).toBe(1);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('canary: a transcript whose tokens differ changes the output', () => {
    const other = mkdtempSync(join(tmpdir(), 'llm-metrics-canary-'));
    try {
      writeFileSync(
        join(other, 'c3c3c3c3-0000-0000-0000-000000000000.jsonl'),
        jsonl([assistant('m9', '2026-09-05T10:00:00.000Z', 70_000, 7)]),
      );
      const r = spawnSync(PYTHON, [SCRIPT, '--root', other, '--specs', specs, '--json'], {
        encoding: 'utf-8',
      });
      expect(JSON.parse(r.stdout).ctx_median).toBe(70_000);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
