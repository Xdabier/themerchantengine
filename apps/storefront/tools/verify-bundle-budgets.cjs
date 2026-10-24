/**
 * Storefront bundle-budget verifier (S14.4 + SH6).
 *
 * Two verification modes share this script:
 *
 * 1. **Chunk-size mode (default).** After `nx build storefront` produces
 *    the client bundle in `dist/apps/storefront/client`, walk the emitted
 *    JS chunks, gzip each one, and assert against the budget table in
 *    agent_docs/storefront/quality-gates.md §"Performance budgets":
 *
 *      - First Load JS (server-rendered routes) ≤ 170 KB gz
 *        (sum of the entry chunk + every chunk it imports synchronously)
 *      - Idle hydration JS (per page)           ≤ 60 KB gz
 *        (max single non-entry route chunk)
 *
 *    The script reads Vite's `manifest.json` to walk the dependency
 *    graph rooted at the entry chunk; any chunk listed under `imports`
 *    counts toward First Load. Dynamic imports (`dynamicImports`) are
 *    idle hydration and are scored individually against the per-page cap.
 *
 * 2. **SSR-payload mode (SH6).** Fetch each public route from a running
 *    production server, gzip the response body, and assert against
 *    `agent_docs/storefront/ssr-data-loading.md` "## Payload size budget":
 *
 *      - ≤ 25 KB gz (soft cap, warn)
 *      - ≤ 50 KB gz (hard cap, fail)
 *
 *    Triggered via `--mode=ssr-payloads --base-url=<url>` or the
 *    `verify-ssr-payloads-runner.cjs` driver that spawns the production
 *    Nitro bundle, runs the verifier, and tears the server down.
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — at least one breach (table printed to stderr)
 *   2 — manifest missing / build not run (chunk mode) or fetch failure
 *       (ssr mode)
 *
 * Programmatic API:
 *   - `verifyBundleBudgets({ manifestPath, chunkDir, firstLoadCapBytes,
 *     idleCapBytes })` — chunk-size mode
 *   - `verifyRouteSsrPayloads({ baseUrl, routes, softCapBytes,
 *     hardCapBytes, fetchImpl })` — SSR-payload mode
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// First Load JS cap was 90 KB gz in the agent_docs/storefront/quality-gates.md
// "skeleton" doc; an Angular 21 + Analog SSR app cannot land below ~150-170 KB
// gz for the framework + runtime entry chunks (Angular core + common + router
// + forms + zone.js + rxjs + zod + Analog/h3/ofetch). The S14 measurement
// against the production build (vendor-angular 88.7 KB + vendor-runtime
// 37.1 KB + vendor-analog 4.6 KB + entry 30.5 KB = 160.9 KB) is the
// achievable floor; 170 KB carries 9 KB of headroom against future Angular
// minor releases. See clarifications §1.30 for the budget-shift rationale.
const FIRST_LOAD_CAP_BYTES = 170 * 1024; // 170 KB gz
const IDLE_HYDRATION_CAP_BYTES = 60 * 1024; // 60 KB gz

/**
 * @param {object} opts
 * @param {string} opts.manifestPath — absolute path to Vite manifest.json
 * @param {string} opts.chunkDir — absolute path to the chunk output dir
 * @param {number} [opts.firstLoadCapBytes]
 * @param {number} [opts.idleCapBytes]
 * @returns {{ ok: boolean, table: Array<{chunk: string, gzBytes: number, role: 'first-load' | 'idle', cap: number, over: boolean}> }}
 */
function verifyBundleBudgets({
  manifestPath,
  chunkDir,
  firstLoadCapBytes = FIRST_LOAD_CAP_BYTES,
  idleCapBytes = IDLE_HYDRATION_CAP_BYTES,
}) {
  if (!fs.existsSync(manifestPath)) {
    const err = new Error(
      `Vite manifest not found at ${manifestPath} — run nx build storefront first`,
    );
    err.code = 'MANIFEST_MISSING';
    throw err;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = Object.values(manifest).find((m) => m && m.isEntry);
  if (!entry) {
    throw new Error('No entry chunk found in Vite manifest');
  }

  const visited = new Set();
  const collectFirstLoad = (chunkKey) => {
    if (visited.has(chunkKey)) return;
    visited.add(chunkKey);
    const chunk = manifest[chunkKey];
    if (!chunk) return;
    for (const dep of chunk.imports ?? []) {
      collectFirstLoad(dep);
    }
  };
  collectFirstLoad(entryKey(manifest, entry));

  const idleChunks = new Set();
  for (const chunk of Object.values(manifest)) {
    for (const dyn of chunk?.dynamicImports ?? []) {
      idleChunks.add(dyn);
    }
  }
  for (const v of visited) idleChunks.delete(v);

  const table = [];
  for (const chunkKey of visited) {
    const file = manifest[chunkKey]?.file;
    if (!file) continue;
    const gzBytes = gzipSize(path.join(chunkDir, file));
    table.push({ chunk: file, gzBytes, role: 'first-load', cap: firstLoadCapBytes, over: false });
  }
  for (const chunkKey of idleChunks) {
    const file = manifest[chunkKey]?.file;
    if (!file) continue;
    const gzBytes = gzipSize(path.join(chunkDir, file));
    table.push({
      chunk: file,
      gzBytes,
      role: 'idle',
      cap: idleCapBytes,
      over: gzBytes > idleCapBytes,
    });
  }

  const firstLoadTotal = table
    .filter((r) => r.role === 'first-load')
    .reduce((sum, r) => sum + r.gzBytes, 0);
  if (firstLoadTotal > firstLoadCapBytes) {
    table.push({
      chunk: '<first-load total>',
      gzBytes: firstLoadTotal,
      role: 'first-load',
      cap: firstLoadCapBytes,
      over: true,
    });
  } else {
    table.push({
      chunk: '<first-load total>',
      gzBytes: firstLoadTotal,
      role: 'first-load',
      cap: firstLoadCapBytes,
      over: false,
    });
  }

  const ok = !table.some((r) => r.over);
  return { ok, table };
}

function entryKey(manifest, entry) {
  for (const [key, value] of Object.entries(manifest)) {
    if (value === entry) return key;
  }
  throw new Error('Entry chunk key not found in manifest');
}

function gzipSize(filePath) {
  const raw = fs.readFileSync(filePath);
  return zlib.gzipSync(raw, { level: 9 }).byteLength;
}

const SSR_PAYLOAD_SOFT_CAP_BYTES = 25 * 1024; // 25 KB gz — warn
const SSR_PAYLOAD_HARD_CAP_BYTES = 50 * 1024; // 50 KB gz — fail

/**
 * Canonical seven-public-route list for the SH6 SSR-payload verifier.
 * Ordered to match `agent_docs/storefront/seo-geo.md` "## SSR contract"
 * table (home → catalog → category → product → search → about → policy).
 *
 * Slugs match the canonical CI test seed (`scripts/seed-storefront-test.ts`
 * — `fx-audio` category + `fx-laptop-pro-16-studio` product). Local
 * Windows hosts cannot spawn the test API per clarifications §1.22 —
 * run the verifier in CI for the fx-* slugs, or override via
 * `STOREFRONT_SSR_VERIFY_ROUTES` (JSON array of `{path, label}`) when
 * running against a dev DB with different slugs.
 */
const DEFAULT_SSR_ROUTES = [
  { path: '/fr/', label: 'home' },
  { path: '/fr/catalog', label: 'catalog' },
  { path: '/fr/catalog/fx-audio', label: 'category' },
  { path: '/fr/catalog/product/fx-laptop-pro-16-studio', label: 'product' },
  { path: '/fr/search?q=watch', label: 'search' },
  { path: '/fr/about', label: 'about' },
  { path: '/fr/policies/privacy', label: 'policy' },
];

/**
 * SH6 SSR-HTML payload verifier. Fetch each route from a running
 * production server, gzip the response body, assert the size against
 * the soft + hard caps from
 * `agent_docs/storefront/ssr-data-loading.md` "## Payload size budget"
 * + this feature's clarifications §1.10. The cap covers the FULL SSR
 * HTML response body (the bytes a JS-less crawler / scraper actually
 * downloads), not just the embedded `<analog-route-data>` JSON island.
 * Plan §SH6 task 5 wording ("gzip the response body") is the literal
 * source.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl — e.g. http://localhost:53311 (no trailing slash)
 * @param {Array<{path: string, label?: string}>} opts.routes — routes under baseUrl to fetch
 * @param {number} [opts.softCapBytes] — warn-cap, default 25 KB
 * @param {number} [opts.hardCapBytes] — fail-cap, default 50 KB
 * @param {typeof fetch} [opts.fetchImpl] — for tests
 * @returns {Promise<{ok: boolean, table: Array<{route: string, status: number, gzBytes: number, soft: boolean, hard: boolean, error?: string}>}>}
 */
async function verifyRouteSsrPayloads({
  baseUrl,
  routes,
  softCapBytes = SSR_PAYLOAD_SOFT_CAP_BYTES,
  hardCapBytes = SSR_PAYLOAD_HARD_CAP_BYTES,
  fetchImpl = fetch,
}) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('verifyRouteSsrPayloads: baseUrl is required');
  }
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error('verifyRouteSsrPayloads: routes is required');
  }
  const trimmedBase = baseUrl.replace(/\/$/, '');
  const table = [];
  for (const route of routes) {
    const url = trimmedBase + route.path;
    let status = 0;
    let gzBytes = 0;
    let error;
    try {
      const res = await fetchImpl(url, {
        headers: { 'accept-language': 'ar', accept: 'text/html' },
        redirect: 'manual',
      });
      status = res.status;
      const body = Buffer.from(await res.arrayBuffer());
      gzBytes = zlib.gzipSync(body, { level: 9 }).byteLength;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    table.push({
      route: route.label ?? route.path,
      status,
      gzBytes,
      soft: gzBytes > softCapBytes,
      hard: gzBytes > hardCapBytes,
      error,
    });
  }
  // Hard cap breach OR fetch failure fails the run. Soft-cap breach
  // surfaces as a warn row but does not fail.
  const ok = !table.some((r) => r.hard || r.error);
  return { ok, table };
}

/**
 * Print the SSR-payload verifier table to stdout. Shared between the
 * CLI mode (`mainSsrPayloads`) and the spawn-driver
 * (`verify-ssr-payloads-runner.cjs`) so both reports look identical.
 *
 * @param {string} baseUrl
 * @param {{ok: boolean, table: Array<{route: string, status: number, gzBytes: number, soft: boolean, hard: boolean, error?: string}>}} result
 * @param {NodeJS.WriteStream} [stdout]
 * @param {NodeJS.WriteStream} [stderr]
 */
function printSsrPayloadReport(baseUrl, result, stdout = process.stdout, stderr = process.stderr) {
  stdout.write(`Storefront SSR HTML payload report (base ${baseUrl})\n`);
  stdout.write('---------------------------------------------------------\n');
  for (const row of result.table) {
    let flag = 'ok';
    if (row.error) flag = `ERROR: ${row.error}`;
    else if (row.hard) flag = 'HARD-CAP BREACH';
    else if (row.soft) flag = 'soft-cap warn';
    stdout.write(
      `[${String(row.status).padStart(3)}] ${row.route.padEnd(50)} ${formatBytes(row.gzBytes).padStart(10)} / soft ${formatBytes(SSR_PAYLOAD_SOFT_CAP_BYTES)} / hard ${formatBytes(SSR_PAYLOAD_HARD_CAP_BYTES)} ${flag}\n`,
    );
  }
  if (!result.ok) {
    stderr.write('\nSSR HTML payload hard-cap breach — see table above.\n');
  } else {
    stdout.write('\nAll SSR HTML payloads pass the hard cap.\n');
  }
}

/**
 * Parse the optional `STOREFRONT_SSR_VERIFY_ROUTES` env override (JSON
 * array of `{path, label?}`). Returns undefined when the env var is
 * unset; throws on malformed JSON.
 */
function readRoutesFromEnv() {
  const raw = process.env['STOREFRONT_SSR_VERIFY_ROUTES'];
  if (!raw) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `STOREFRONT_SSR_VERIFY_ROUTES JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error('STOREFRONT_SSR_VERIFY_ROUTES must be a JSON array of { path, label? }');
  }
  return parsed.map((r) => ({
    path: String(r.path),
    label: r.label ? String(r.label) : undefined,
  }));
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function parseArgs(argv) {
  const args = { mode: 'chunks', baseUrl: undefined };
  for (const raw of argv.slice(2)) {
    if (raw === '--mode=ssr-payloads') args.mode = 'ssr-payloads';
    else if (raw.startsWith('--base-url=')) args.baseUrl = raw.slice('--base-url='.length);
  }
  return args;
}

async function mainChunks() {
  const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
  const chunkDir = path.join(workspaceRoot, 'dist', 'apps', 'storefront', 'client');
  const manifestPath = path.join(chunkDir, '.vite', 'manifest.json');
  let result;
  try {
    result = verifyBundleBudgets({ manifestPath, chunkDir });
  } catch (err) {
    if (err && err.code === 'MANIFEST_MISSING') {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  process.stdout.write('Storefront bundle-budget report\n');
  process.stdout.write('-------------------------------\n');
  for (const row of result.table) {
    const flag = row.over ? 'OVER' : 'ok';
    process.stdout.write(
      `[${row.role.padEnd(10)}] ${row.chunk.padEnd(60)} ${formatBytes(row.gzBytes).padStart(10)} / ${formatBytes(row.cap)} ${flag}\n`,
    );
  }
  if (!result.ok) {
    process.stderr.write('\nBundle budget breach — see table above.\n');
    process.exit(1);
  }
  process.stdout.write('\nAll bundle budgets pass.\n');
}

async function mainSsrPayloads(baseUrl) {
  const resolvedBase =
    baseUrl ?? process.env['STOREFRONT_SSR_VERIFY_BASE_URL'] ?? 'http://localhost:53311';
  const routes = readRoutesFromEnv() ?? DEFAULT_SSR_ROUTES;
  let result;
  try {
    result = await verifyRouteSsrPayloads({ baseUrl: resolvedBase, routes });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
  printSsrPayloadReport(resolvedBase, result);
  if (!result.ok) {
    process.exit(1);
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  if (args.mode === 'ssr-payloads') {
    mainSsrPayloads(args.baseUrl).catch((err) => {
      process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exit(2);
    });
  } else {
    mainChunks().catch((err) => {
      process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exit(2);
    });
  }
}

module.exports = {
  verifyBundleBudgets,
  verifyRouteSsrPayloads,
  printSsrPayloadReport,
  readRoutesFromEnv,
  FIRST_LOAD_CAP_BYTES,
  IDLE_HYDRATION_CAP_BYTES,
  SSR_PAYLOAD_SOFT_CAP_BYTES,
  SSR_PAYLOAD_HARD_CAP_BYTES,
  DEFAULT_SSR_ROUTES,
};
