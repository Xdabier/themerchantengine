#!/usr/bin/env node
// Moves the "## Phase log" section of every plan under specs/ into a sibling
// phase-log.md. The plan keeps a two-line pointer. Old lines land verbatim under
// "## Archive"; new lines go under "## Log" and lint-instructions caps them at
// 300 characters. Idempotent: a plan whose section is already the pointer is skipped.
//
//   node scripts/llm-metrics/split-phase-logs.mjs [--specs specs] [--dry-run]

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const specsDir = args.includes('--specs') ? args[args.indexOf('--specs') + 1] : 'specs';
const dryRun = args.includes('--dry-run');
const HEADING = '## Phase log';
const pointerFor = (logName) => `${HEADING}\n\nLines live in \`${logName}\` next to this file. Append there, never here.\n`;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function splitPlan(planPath, today = new Date().toISOString().slice(0, 10)) {
  // Working trees here are autocrlf; git stores LF, so LF out is diff-neutral.
  const source = readFileSync(planPath, 'utf8').replace(/\r\n/g, '\n');
  const idx = source.indexOf(`\n${HEADING}\n`);
  if (idx < 0) return null;
  const head = source.slice(0, idx + 1);
  const section = source.slice(idx + 1 + HEADING.length + 1);
  if (section.trim().startsWith('Lines live in `')) return null;

  // A plan at the specs root has no directory of its own, so its log carries the plan name.
  const atRoot = dirname(planPath).replace(/\\/g, '/').replace(/\/$/, '') === specsDir.replace(/\\/g, '/').replace(/\/$/, '');
  const logName = atRoot ? `${basename(planPath, '.md').replace(/-plan$/, '')}-phase-log.md` : 'phase-log.md';
  const logPath = join(dirname(planPath), logName);
  if (existsSync(logPath)) {
    console.warn(`skip ${planPath}: ${logPath} already exists`);
    return null;
  }

  const title = atRoot ? basename(planPath, '.md') : basename(dirname(planPath));
  const log = [
    `# Phase log: ${title}`,
    '',
    'One line per phase, at most 300 characters: phase id, SHA range, date, gate result, tokens in/out',
    'from `npm run llm:metrics -- --session current`. Narrative goes in the commit body or a decision record.',
    '',
    '## Log',
    '',
    '## Archive',
    '',
    `Moved verbatim from \`${basename(planPath)}\` on ${today}. Not capped.`,
    '',
    section.trim(),
    '',
  ].join('\n');

  return { plan: head + pointerFor(logName), log, logPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const plan of walk(specsDir)) {
    const result = splitPlan(plan);
    if (!result) continue;
    console.log(`${plan} -> ${result.logPath}`);
    if (dryRun) continue;
    writeFileSync(result.logPath, result.log);
    writeFileSync(plan, result.plan);
  }
}
