#!/usr/bin/env node
// Lints the instruction files Claude Code loads (every CLAUDE.md, .claude/**, agent_docs/**,
// the constitution and its index) plus the phase logs and the memory index.
// Fails when an instruction names an npm script, nx project or port that does not exist,
// pairs an nx project with a port the CLAUDE.md table gives another service, references a
// repo path that does not exist, exceeds its line or byte cap, keeps an inline phase log in
// a plan, or when a phase-log or memory line exceeds its length cap. Runs at pre-push.
//
//   node scripts/llm-metrics/lint-instructions.mjs [--root DIR] [--memory FILE]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const CAPS = {
  claudeMd: 80,
  ruleFile: 60,
  indexBytes: 2048,
  phaseLogLine: 300,
  memoryLine: 160,
  memoryBytes: 8192,
};

// Claude Code names a project's directory after its path, every non-alphanumeric as `-`.
export function memoryFileFor(root) {
  const slug = resolve(root).replace(/[^a-zA-Z0-9]/g, '-');
  return join(homedir(), '.claude', 'projects', slug, 'memory', 'MEMORY.md');
}

const PATH_PREFIXES = ['apps', 'libs', 'specs', 'agent_docs', 'docs', 'scripts', 'tools', 'prisma', 'test', '.claude'];
// The e2e projects call the API on 53001 as well as their own app, so they are not mapped.
const SERVICE_OF_PROJECT = { api: 'api', admin: 'admin', storefront: 'storefront' };

function walk(dir, filter) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.git') || name === '.nx') continue;
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const lines = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
const rel = (root, file) => relative(root, file).replace(/\\/g, '/');
const lineCount = (file) => lines(file).filter((l, i, a) => i < a.length - 1 || l !== '').length;

export function claudeMdFiles(root) {
  const out = [];
  if (existsSync(join(root, 'CLAUDE.md'))) out.push(join(root, 'CLAUDE.md'));
  for (const dir of ['apps', 'libs', 'tools']) out.push(...walk(join(root, dir), (f) => basename(f) === 'CLAUDE.md'));
  return out;
}

export function instructionFiles(root) {
  const md = (f) => f.endsWith('.md');
  const files = [...claudeMdFiles(root)];
  for (const f of ['specs/constitution.md', 'specs/constitution-index.md']) {
    if (existsSync(join(root, f))) files.push(join(root, f));
  }
  files.push(...walk(join(root, '.claude', 'rules'), md));
  files.push(...walk(join(root, '.claude', 'commands'), md));
  files.push(...walk(join(root, '.claude', 'skills'), (f) => f.endsWith('SKILL.md')));
  files.push(...walk(join(root, '.claude', 'agents'), md));
  files.push(...walk(join(root, '.claude', 'hooks'), (f) => f.endsWith('.sh')));
  files.push(...walk(join(root, 'agent_docs'), md));
  return files;
}

export function knownScripts(root) {
  const pkg = join(root, 'package.json');
  if (!existsSync(pkg)) return new Set();
  return new Set(Object.keys(JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {}));
}

export function knownProjects(root) {
  const names = new Set();
  for (const f of walk(root, (p) => p.endsWith('project.json'))) {
    try {
      const name = JSON.parse(readFileSync(f, 'utf8')).name;
      if (name) names.add(name);
    } catch {
      // not an nx project file
    }
  }
  return names;
}

// The CLAUDE.md port table is the single source: every five-digit port on a row belongs to
// the service the row names (api, admin, storefront, postgres, redis).
export function portTable(root) {
  const file = join(root, 'CLAUDE.md');
  const all = new Set();
  const byService = {};
  if (!existsSync(file)) return { all, byService };
  for (const line of lines(file)) {
    if (!line.startsWith('|')) continue;
    const label = line.split('|')[1]?.toLowerCase() ?? '';
    const service = ['api', 'admin', 'storefront', 'postgres', 'redis'].find((s) => label.includes(s));
    for (const m of line.matchAll(/\b(\d{5})\b/g)) {
      all.add(m[1]);
      if (service) (byService[service] ??= new Set()).add(m[1]);
    }
  }
  return { all, byService };
}

function activeLines(root, file) {
  // The constitution's Amendment Log is history; paths it names may be gone.
  const all = lines(file);
  if (rel(root, file) === 'specs/constitution.md') {
    const cut = all.findIndex((l) => l.startsWith('### Amendment Log'));
    return cut >= 0 ? all.slice(0, cut) : all;
  }
  return all;
}

export function lint(root, { memoryFile = memoryFileFor(root) } = {}) {
  root = resolve(root);
  const findings = [];
  const add = (file, n, msg) => findings.push(`${rel(root, file)}:${n}: ${msg}`);
  const scripts = knownScripts(root);
  const projects = knownProjects(root);
  const ports = portTable(root);

  // Line and byte caps.
  for (const f of claudeMdFiles(root)) {
    const n = lineCount(f);
    if (n > CAPS.claudeMd) add(f, 1, `CLAUDE.md has ${n} lines, cap ${CAPS.claudeMd}`);
  }
  for (const f of walk(join(root, '.claude', 'rules'), (p) => p.endsWith('.md'))) {
    const n = lineCount(f);
    if (n > CAPS.ruleFile) add(f, 1, `rule file has ${n} lines, cap ${CAPS.ruleFile}`);
  }
  const index = join(root, 'specs', 'constitution-index.md');
  if (existsSync(index) && statSync(index).size > CAPS.indexBytes) {
    add(index, 1, `constitution index is ${statSync(index).size} bytes, cap ${CAPS.indexBytes}`);
  }

  // Command, project, port and path references.
  for (const file of instructionFiles(root)) {
    activeLines(root, file).forEach((line, i) => {
      const n = i + 1;
      for (const m of line.matchAll(/\bnpm run ([a-z0-9:_-]+)/g)) {
        if (!scripts.has(m[1])) add(file, n, `unknown npm script "${m[1]}"`);
      }
      for (const m of line.matchAll(/\bnx (?:serve|test|e2e|lint|build|run) ([a-z][a-z0-9-]*)(?::[a-z0-9:-]+)?\b/g)) {
        const target = m[1];
        if (['affected', 'run-many', 'show', 'graph', 'reset'].includes(target)) continue;
        if (!projects.has(target)) add(file, n, `unknown nx project "${target}"`);
        // Same command, different port: an nx command and a port on one line must agree
        // with the CLAUDE.md table.
        const service = SERVICE_OF_PROJECT[target];
        const own = service ? ports.byService[service] : undefined;
        if (!own) continue;
        for (const p of line.matchAll(/(?:localhost:|--port[= ]|-p )(\d{4,5})\b/g)) {
          if (!own.has(p[1])) add(file, n, `nx ${target} paired with port ${p[1]}, which the CLAUDE.md table does not give ${service}`);
        }
      }
      for (const m of line.matchAll(/\blocalhost:(\d{4,5})\b/g)) {
        if (!ports.all.has(m[1])) add(file, n, `port ${m[1]} is not in the CLAUDE.md port table`);
      }
      // Markdown quotes paths in backticks; a shell script cannot, so scan its bare tokens.
      const tokenRx = file.endsWith('.sh') ? /(?:^|[\s"'(=])((?:apps|libs|specs|agent_docs|docs|scripts|tools|prisma|test|\.claude)\/[^\s"'`)]+)/g : /`([^`\s]+)`/g;
      for (const m of line.matchAll(tokenRx)) {
        const token = m[1].replace(/[;,.:]+$/, '');
        const first = token.split('/')[0];
        if (!PATH_PREFIXES.includes(first) || !token.includes('/')) continue;
        if (/[$<>|(]/.test(token) || token.includes('...')) continue;
        let p = token.replace(/:[\d,–-]+$/, '');
        // A glob segment cannot be checked; check the directory that holds it.
        const glob = p.search(/[*{?[]/);
        if (glob >= 0) p = p.slice(0, p.lastIndexOf('/', glob));
        p = p.replace(/\/+$/, '');
        if (p.endsWith('.')) p = p.slice(0, -1);
        if (!p || p === first) continue;
        if (!existsSync(join(root, p))) add(file, n, `path "${token}" does not exist`);
      }
    });
  }

  // Plans keep only the pointer under "## Phase log"; the lines live in phase-log.md.
  for (const f of walk(join(root, 'specs'), (p) => p.endsWith('.md') && !/phase-log\.md$/.test(p) && !/tasks-archive\.md$/.test(p))) {
    const all = lines(f);
    const at = all.findIndex((l) => l.trim() === '## Phase log');
    if (at < 0) continue;
    const next = all.slice(at + 1).find((l) => l.trim() !== '') ?? '';
    if (!next.startsWith('Lines live in `')) add(f, at + 1, 'plan carries an inline phase log; run scripts/llm-metrics/split-phase-logs.mjs');
  }

  // Phase-log lines under "## Log".
  for (const f of walk(join(root, 'specs'), (p) => /(^|[\\/])([a-z0-9-]+-)?phase-log\.md$/.test(p))) {
    let inLog = false;
    lines(f).forEach((line, i) => {
      if (line.startsWith('## Log')) inLog = true;
      else if (line.startsWith('## Archive')) inLog = false;
      else if (inLog && line.length > CAPS.phaseLogLine) add(f, i + 1, `phase-log line is ${line.length} chars, cap ${CAPS.phaseLogLine}`);
    });
  }

  // Memory index.
  if (memoryFile && existsSync(memoryFile)) {
    const bytes = statSync(memoryFile).size;
    if (bytes > CAPS.memoryBytes) findings.push(`MEMORY.md: ${bytes} bytes, cap ${CAPS.memoryBytes}`);
    lines(memoryFile).forEach((line, i) => {
      if (line.length > CAPS.memoryLine) findings.push(`MEMORY.md:${i + 1}: line is ${line.length} chars, cap ${CAPS.memoryLine}`);
    });
  }

  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = opt('--root') ?? process.cwd();
  const memoryFile = opt('--memory') ?? memoryFileFor(root);
  const findings = lint(root, { memoryFile });
  for (const f of findings) console.log(f);
  console.log(findings.length ? `lint-instructions: ${findings.length} finding(s)` : 'lint-instructions: clean');
  process.exit(findings.length ? 1 : 0);
}
