/**
 * Client-reference guard for the brandless engine tree (plan E0.2).
 *
 * Scans every tracked and untracked-but-not-ignored text file for the names,
 * currencies and places of the two client stores that shaped the engine.
 * A hit outside the allowlist fails the run. Every allowlist entry names the
 * phase that retires it and must still match at least one hit; an entry that
 * matches nothing is stale and fails the run too, so the allowlist can only
 * shrink as phases land.
 *
 *   npm run verify:no-client-refs            # exit 0 clean, 1 violations or stale entries
 *   npm run verify:no-client-refs -- --list  # also print allowlisted hits
 *   npm run verify:no-client-refs -- --summary  # hit counts per directory, for authoring
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface Token {
  name: string;
  pattern: RegExp;
}

// The patterns use lookarounds instead of \b so an upper-snake identifier
// carrying a token hits while an unrelated English word that merely contains
// its letters (`students`, `incidents`, `dependents`, `opportunistic`) does
// not. The currency codes are matched case-sensitively on purpose: ISO 4217
// codes are upper-case in every file that means them, and a lower-case
// three-letter fragment is far more often part of another word.
//
// The table lives in verify-no-client-refs.tokens.json, which names the
// clients and therefore stays out of the release archive (.gitattributes
// export-ignore), while this guard and its allowlist ship. A tarball user who
// runs the gate is told it is repository-only rather than handed a stack.
export const TOKENS_FILE = path.join(__dirname, 'verify-no-client-refs.tokens.json');

export function loadTokens(file: string = TOKENS_FILE): readonly Token[] {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${path.basename(file)} is not here: this gate runs in the engine repository only, and its token table does not ship in a release archive.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    tokens: { name: string; source: string; flags: string }[];
  };
  if (!Array.isArray(raw.tokens) || raw.tokens.length === 0) {
    throw new Error(`${file}: no tokens`);
  }
  return raw.tokens.map((t) => ({ name: t.name, pattern: new RegExp(t.source, t.flags) }));
}

let tokensCache: readonly Token[] | undefined;
function tokens(): readonly Token[] {
  tokensCache ??= loadTokens();
  return tokensCache;
}

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.zip',
  '.gz',
  '.br',
  '.mp4',
  '.webm',
  '.wasm',
  '.psd',
  '.ai',
]);

export interface AllowlistEntry {
  /** Repo-relative path. A trailing slash makes it a directory prefix. */
  path: string;
  /** Phase that removes the last reference under this path, or `never`. */
  retiredBy: string;
  reason: string;
  /**
   * Exact-file entries only. Hits are allowed from the first line containing
   * this marker onward; hits above it stay violations. Lets a dated history
   * section (an amendment log) sit inside a file whose body must be clean.
   */
  fromMarker?: string;
}

export interface Hit {
  file: string;
  line: number;
  token: string;
  text: string;
}

export interface ScanResult {
  violations: Hit[];
  allowed: Hit[];
  staleEntries: AllowlistEntry[];
  filesScanned: number;
}

export function listFiles(root: string): string[] {
  const out = execFileSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split('\0').filter((f) => f.length > 0);
}

function isBinary(file: string, buffer: Buffer): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  const probe = buffer.subarray(0, 8192);
  return probe.includes(0);
}

export function scanContent(file: string, content: string): Hit[] {
  const hits: Hit[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const token of tokens()) {
      if (token.pattern.test(lines[i])) {
        hits.push({ file, line: i + 1, token: token.name, text: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

export function loadAllowlist(file: string): AllowlistEntry[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: unknown };
  if (!Array.isArray(parsed.entries)) throw new Error(`${file}: expected { entries: [] }`);
  return parsed.entries.map((raw, i) => {
    const e = raw as Partial<AllowlistEntry>;
    if (
      typeof e.path !== 'string' ||
      typeof e.retiredBy !== 'string' ||
      typeof e.reason !== 'string'
    ) {
      throw new Error(`${file}: entry ${i} needs path, retiredBy and reason`);
    }
    if (e.fromMarker !== undefined && (typeof e.fromMarker !== 'string' || e.path.endsWith('/'))) {
      throw new Error(`${file}: entry ${i}: fromMarker must be a string on an exact-file entry`);
    }
    return { path: e.path, retiredBy: e.retiredBy, reason: e.reason, fromMarker: e.fromMarker };
  });
}

/** 1-based line of the first occurrence, or Infinity when the marker is absent (nothing allowed). */
function markerLineNumber(content: string, marker: string): number {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes(marker));
  return idx < 0 ? Number.POSITIVE_INFINITY : idx + 1;
}

function matches(entry: AllowlistEntry, file: string): boolean {
  return entry.path.endsWith('/') ? file.startsWith(entry.path) : file === entry.path;
}

/** The most specific matching entry: an exact file beats any directory, a longer prefix beats a shorter one. */
export function bestEntry(allowlist: AllowlistEntry[], file: string): AllowlistEntry | undefined {
  let best: AllowlistEntry | undefined;
  for (const entry of allowlist) {
    if (!matches(entry, file)) continue;
    if (!best) {
      best = entry;
      continue;
    }
    const bestIsDir = best.path.endsWith('/');
    const entryIsDir = entry.path.endsWith('/');
    if (bestIsDir && !entryIsDir) best = entry;
    else if (bestIsDir === entryIsDir && entry.path.length > best.path.length) best = entry;
  }
  return best;
}

export function scan(root: string, files: string[], allowlist: AllowlistEntry[]): ScanResult {
  const violations: Hit[] = [];
  const allowed: Hit[] = [];
  const used = new Set<AllowlistEntry>();
  let filesScanned = 0;

  for (const file of files) {
    const abs = path.join(root, file);
    let buffer: Buffer;
    try {
      if (!fs.statSync(abs).isFile()) continue;
      buffer = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (isBinary(file, buffer)) continue;
    filesScanned++;
    const content = buffer.toString('utf8');
    const hits = scanContent(file, content);
    if (hits.length === 0) continue;
    const entry = bestEntry(allowlist, file);
    if (!entry) {
      violations.push(...hits);
      continue;
    }
    const markerLine = entry.fromMarker ? markerLineNumber(content, entry.fromMarker) : 1;
    let usedHere = false;
    for (const hit of hits) {
      if (hit.line >= markerLine) {
        allowed.push(hit);
        usedHere = true;
      } else {
        violations.push(hit);
      }
    }
    if (usedHere) used.add(entry);
  }

  return {
    violations,
    allowed,
    staleEntries: allowlist.filter((e) => !used.has(e)),
    filesScanned,
  };
}

export interface RunOptions {
  root: string;
  allowlistPath: string;
  list?: boolean;
  summary?: boolean;
}

export function run(opts: RunOptions): { exitCode: number; output: string } {
  const lines: string[] = [];
  const allowlist = loadAllowlist(opts.allowlistPath);
  const files = listFiles(opts.root);
  const result = scan(opts.root, files, allowlist);

  if (opts.summary) {
    const counts = new Map<string, number>();
    for (const hit of [...result.violations, ...result.allowed]) {
      const parts = hit.file.split('/');
      const key = parts.length > 2 ? parts.slice(0, 2).join('/') + '/' : hit.file;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`${String(n).padStart(6)}  ${key}`);
    }
  }

  if (opts.list) {
    for (const hit of result.allowed) {
      lines.push(`allowed  ${hit.file}:${hit.line}: ${hit.token} | ${hit.text}`);
    }
  }
  for (const hit of result.violations) {
    lines.push(`${hit.file}:${hit.line}: ${hit.token} | ${hit.text}`);
  }
  for (const entry of result.staleEntries) {
    lines.push(
      `stale allowlist entry: ${entry.path} (retiredBy ${entry.retiredBy}) matches no hit, remove it`,
    );
  }

  const violationFiles = new Set(result.violations.map((h) => h.file)).size;
  const allowedFiles = new Set(result.allowed.map((h) => h.file)).size;
  lines.push(
    `verify-no-client-refs: ${result.filesScanned} files scanned, ` +
      `${result.violations.length} violations in ${violationFiles} files, ` +
      `${result.allowed.length} allowlisted hits in ${allowedFiles} files, ` +
      `${result.staleEntries.length} stale allowlist entries`,
  );

  const exitCode = result.violations.length > 0 || result.staleEntries.length > 0 ? 1 : 0;
  return { exitCode, output: lines.join('\n') };
}

function parseArgs(argv: string[]): RunOptions {
  const root = path.resolve(__dirname, '..');
  const opts: RunOptions = {
    root,
    allowlistPath: path.join(__dirname, 'verify-no-client-refs.allowlist.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') opts.root = path.resolve(argv[++i]);
    else if (arg === '--allowlist') opts.allowlistPath = path.resolve(argv[++i]);
    else if (arg === '--list') opts.list = true;
    else if (arg === '--summary') opts.summary = true;
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

if (require.main === module) {
  if (!fs.existsSync(TOKENS_FILE)) {
    console.error(
      'verify-no-client-refs: this gate runs in the engine repository only; its token table does not ship in a release archive.',
    );
    process.exit(2);
  }
  const { exitCode, output } = run(parseArgs(process.argv.slice(2)));
  console.log(output);
  process.exit(exitCode);
}
