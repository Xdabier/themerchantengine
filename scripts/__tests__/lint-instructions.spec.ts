import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without a declaration file
import { CAPS, lint, memoryFileFor } from '../llm-metrics/lint-instructions.mjs';

// Every rule gets a passing fixture and a canary that turns it red, so the guard
// is proven able to fail in the same commit that ships it.

let root: string;
let memory: string;
const SCRIPT = resolve(__dirname, '../llm-metrics/lint-instructions.mjs');

function write(path: string, content: string) {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function cleanTree() {
  write(
    'CLAUDE.md',
    '# root\n\n| API dev / e2e | 53000 / 53001 |\n| Admin dev | 53200 |\n\n`agent_docs/testing.md` and `npm run test:e2e`, `nx serve api` on `localhost:53000`.\n',
  );
  write('package.json', JSON.stringify({ scripts: { 'test:e2e': 'nx e2e api' } }));
  write('apps/api/project.json', JSON.stringify({ name: 'api' }));
  write('apps/admin/project.json', JSON.stringify({ name: 'admin' }));
  write('agent_docs/testing.md', 'Run against `localhost:53000`.\n');
  write(
    'specs/constitution.md',
    '# c\n\nSee `agent_docs/testing.md`.\n\n### Amendment Log\n\nOld `apps/gone/CLAUDE.md` retired.\n',
  );
  write('specs/constitution-index.md', '# index\n\n- rule. §3.1\n');
  write(
    'specs/features/x/plan.md',
    '# plan\n\n## Phase log\n\nLines live in `phase-log.md` next to this file. Append there, never here.\n',
  );
  write('.claude/rules/api.md', '---\npaths:\n  - "apps/api/**"\n---\n\nShort rule.\n');
  write('.claude/hooks/session-start.sh', 'echo "see agent_docs/testing.md"\n');
  write(
    'specs/features/x/phase-log.md',
    '# log\n\n## Log\n\nX0 - short - 2026-09-21\n\n## Archive\n\n' + 'y'.repeat(2000) + '\n',
  );
  writeFileSync(memory, '# Memory\n\n- [a](a.md) - short hook\n', 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lint-instructions-'));
  memory = join(root, 'MEMORY.md');
  cleanTree();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = () => lint(root, { memoryFile: memory });

describe('lint-instructions', () => {
  it('is clean on a consistent tree (archive and amendment log are exempt)', () => {
    expect(run()).toEqual([]);
  });

  it('derives the default memory index from the project path, as Claude Code names it', () => {
    const project = join(parse(process.cwd()).root, 'Users', 'someone', 'my_repo', 'engine');
    const file = memoryFileFor(project);
    expect(file.startsWith(homedir())).toBe(true);
    expect(file).toMatch(
      /[\\/]\.claude[\\/]projects[\\/][A-Za-z-]*-Users-someone-my-repo-engine[\\/]memory[\\/]MEMORY\.md$/,
    );
  });

  it('flags an unknown npm script', () => {
    write('agent_docs/testing.md', 'Run `npm run test:nope`.\n');
    expect(run()).toEqual([expect.stringContaining('unknown npm script "test:nope"')]);
  });

  it('flags an unknown nx project', () => {
    write('agent_docs/testing.md', 'Run `nx e2e api-e2e`.\n');
    expect(run()).toEqual([expect.stringContaining('unknown nx project "api-e2e"')]);
  });

  it('flags a port outside the CLAUDE.md table', () => {
    write('agent_docs/testing.md', 'Open http://localhost:4300 now.\n');
    expect(run()).toEqual([
      expect.stringContaining('port 4300 is not in the CLAUDE.md port table'),
    ]);
  });

  it('flags the same nx command paired with another service’s port, in any instruction file including hooks', () => {
    write('.claude/hooks/session-start.sh', 'echo "nx serve admin on http://localhost:53000"\n');
    expect(run()).toEqual([
      expect.stringContaining(
        'nx admin paired with port 53000, which the CLAUDE.md table does not give admin',
      ),
    ]);
    write('.claude/hooks/session-start.sh', 'echo "nx serve admin --port 53200"\n');
    expect(run()).toEqual([]);
  });

  it('flags a referenced path that does not exist, after stripping globs and line suffixes', () => {
    write(
      'agent_docs/testing.md',
      'See `apps/api/src/missing.ts:12` and `libs/nope/**` and `apps/api/**`.\n',
    );
    const out = run();
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('path "apps/api/src/missing.ts:12" does not exist');
    expect(out[1]).toContain('path "libs/nope/**" does not exist');
  });

  it('flags a stale bare path inside a hook script, where backticks are not available', () => {
    write(
      '.claude/hooks/session-start.sh',
      'echo "  > CLAUDE.md (root + apps/admin/CLAUDE.md + any subdir)"\n',
    );
    expect(run()).toEqual([
      expect.stringContaining(
        '.claude/hooks/session-start.sh:1: path "apps/admin/CLAUDE.md" does not exist',
      ),
    ]);
    write('.claude/hooks/session-start.sh', 'echo "see agent_docs/testing.md and apps/api/"\n');
    expect(run()).toEqual([]);
  });

  it('exempts the amendment log only in the constitution, not in other files', () => {
    write('agent_docs/testing.md', '### Amendment Log\n\nOld `apps/gone/CLAUDE.md` retired.\n');
    expect(run()).toEqual([
      expect.stringContaining('agent_docs/testing.md:3: path "apps/gone/CLAUDE.md" does not exist'),
    ]);
  });

  it('flags any CLAUDE.md over the line cap, including one under apps/', () => {
    write('apps/admin/CLAUDE.md', 'line\n'.repeat(CAPS.claudeMd + 1));
    expect(run()).toEqual([
      expect.stringContaining(
        `apps/admin/CLAUDE.md:1: CLAUDE.md has ${CAPS.claudeMd + 1} lines, cap ${CAPS.claudeMd}`,
      ),
    ]);
  });

  it('flags a rule file over the line cap', () => {
    write('.claude/rules/api.md', 'x\n'.repeat(CAPS.ruleFile + 1));
    expect(run()).toEqual([
      expect.stringContaining(`rule file has ${CAPS.ruleFile + 1} lines, cap ${CAPS.ruleFile}`),
    ]);
  });

  it('flags a constitution index over 2 KB', () => {
    write('specs/constitution-index.md', '- rule. §3.1\n'.repeat(200));
    expect(run()).toEqual([expect.stringContaining(`constitution index is`)]);
    expect(run()[0]).toContain(`bytes, cap ${CAPS.indexBytes}`);
  });

  it('flags a plan that grew an inline phase log back', () => {
    write(
      'specs/features/x/plan.md',
      '# plan\n\n## Phase log\n\nX1 - 2026-09-22 - a line that should be in phase-log.md\n',
    );
    expect(run()).toEqual([
      expect.stringContaining('specs/features/x/plan.md:3: plan carries an inline phase log'),
    ]);
  });

  it('flags a phase-log line over 300 characters under Log but not under Archive', () => {
    write(
      'specs/features/x/phase-log.md',
      '## Log\n\n' + 'z'.repeat(301) + '\n\n## Archive\n\n' + 'z'.repeat(400) + '\n',
    );
    expect(run()).toEqual([expect.stringContaining('phase-log line is 301 chars, cap 300')]);
  });

  it('flags a memory index line over 160 characters and a file over 8 KB', () => {
    writeFileSync(
      memory,
      '# Memory\n\n- [a](a.md) - ' + 'h'.repeat(160) + '\n' + '- [b](b.md) - hook\n'.repeat(500),
      'utf8',
    );
    const out = run();
    expect(out.some((f) => f.includes('bytes, cap 8192'))).toBe(true);
    expect(out.some((f) => f.includes('line is 174 chars, cap 160'))).toBe(true);
  });

  it('exits 0 on a clean tree and 1 with the findings printed, honouring --root and --memory', () => {
    const clean = execFileSync('node', [SCRIPT, '--root', root, '--memory', memory], {
      encoding: 'utf8',
    });
    expect(clean.trim()).toBe('lint-instructions: clean');
    write('agent_docs/testing.md', 'Run `npm run test:nope`.\n');
    let status = 0;
    let stdout = '';
    try {
      execFileSync('node', [SCRIPT, '--root', root, '--memory', memory], { encoding: 'utf8' });
    } catch (err) {
      status = (err as { status: number }).status;
      stdout = (err as { stdout: string }).stdout;
    }
    expect(status).toBe(1);
    expect(stdout).toContain('unknown npm script "test:nope"');
    expect(stdout).toContain('lint-instructions: 1 finding(s)');
  });
});
