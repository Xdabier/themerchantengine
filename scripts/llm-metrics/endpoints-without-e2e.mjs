#!/usr/bin/env node
// endpoints-without-e2e.mjs - list the admin routes that no journey spec drives.
//
// Replaces the census half of the retired `test-coverage-auditor` and
// `admin-test-writer`. It is a report, not a gate: which endpoints deserve a
// journey is a judgement, and a hard threshold here would only teach people to
// write a journey that navigates and asserts nothing. The reviewer reads this
// list; the coverage thresholds in the Jest configs are the enforced floor.
//
// Usage:
//   node scripts/llm-metrics/endpoints-without-e2e.mjs          # uncovered only
//   node scripts/llm-metrics/endpoints-without-e2e.mjs --all    # every route
//   node scripts/llm-metrics/endpoints-without-e2e.mjs --json

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ROUTES_SOURCE = 'libs/shared/admin-routes/src/index.ts';
const CONTROLLER_DIR = 'apps/api/src';
const JOURNEY_DIRS = ['apps/admin-e2e/src', 'apps/admin-services-e2e/src'];
const ADMIN_SERVICES_DIR = 'libs/admin-services/src';

function walk(dir, predicate, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/** Every `key: 'admin/...'` string in the shared route tree, with its key path. */
function adminRoutePaths() {
  const source = readFileSync(join(REPO_ROOT, ROUTES_SOURCE), 'utf8');
  const paths = new Set();
  for (const match of source.matchAll(/['"]((?:v1\/)?admin\/[^'"]*)['"]/g)) {
    paths.add(match[1].replace(/^v1\//, ''));
  }
  return [...paths].sort();
}

/** A route counts as driven when its literal path, or the path with its
 * `:param` segments loosened, appears in a journey spec or an admin service
 * that a journey exercises. */
function coverageIndex() {
  const texts = [];
  for (const dir of [...JOURNEY_DIRS, ADMIN_SERVICES_DIR]) {
    for (const file of walk(join(REPO_ROOT, dir), (p) => p.endsWith('.ts'))) {
      texts.push(readFileSync(file, 'utf8'));
    }
  }
  return texts.join('\n');
}

function isDriven(routePath, haystack) {
  const literal = routePath.replace(/:[A-Za-z]\w*(\([^)]*\))?/g, '');
  const stem = literal.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  if (stem.length < 8) return true; // too short to match usefully; do not cry wolf
  return haystack.includes(stem);
}

function controllerPaths() {
  const files = walk(join(REPO_ROOT, CONTROLLER_DIR), (p) => p.endsWith('.controller.ts'));
  return files.map((f) => relative(REPO_ROOT, f).split(sep).join('/'));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const haystack = coverageIndex();
  const routes = adminRoutePaths();
  const rows = routes.map((path) => ({ path, driven: isDriven(path, haystack) }));
  const uncovered = rows.filter((r) => !r.driven);

  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify({ total: rows.length, uncovered: uncovered.map((r) => r.path) }, null, 2)}\n`);
    return;
  }

  const shown = args.has('--all') ? rows : uncovered.map((r) => ({ ...r }));
  process.stdout.write(`admin routes: ${rows.length}, controllers: ${controllerPaths().length}\n`);
  process.stdout.write(`no journey spec names them: ${uncovered.length}\n\n`);
  for (const row of shown) {
    process.stdout.write(`${args.has('--all') ? (row.driven ? '  ok  ' : '  --  ') : '  '}${row.path}\n`);
  }
  if (uncovered.length > 0) {
    process.stdout.write('\nThis is a report, not a gate. A route here either needs a journey or is\n');
    process.stdout.write('covered by one under a path this script cannot see; the reviewer decides.\n');
  }
}

main();

export { adminRoutePaths, isDriven };


