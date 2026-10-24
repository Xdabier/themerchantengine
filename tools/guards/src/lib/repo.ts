import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Repository root, derived from this file's location rather than `process.cwd()`
 * so a guard behaves the same under `nx run guards:test`, a bare `jest` run and
 * the pre-commit hook.
 *
 * `GUARDS_ROOT` points the scan at another checkout. It exists for one job:
 * running today's guards against an older commit, to check they would have
 * caught what an auditor caught on that phase. It is read-only and it cannot
 * make a red guard green on this tree, because the gate never sets it. */
export const REPO_ROOT = process.env['GUARDS_ROOT']
  ? resolve(process.env['GUARDS_ROOT'])
  : resolve(__dirname, '..', '..', '..', '..');

/** Directories that never hold reviewable source. */
const ALWAYS_SKIP = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.nx',
  '.git',
  '.angular',
  'tmp',
  '.vite',
  '.cache',
]);

/** The canary fixtures deliberately violate every guard. They are loaded on
 * purpose by the canary tests and must never reach a real scan. */
const CANARY_DIR = 'tools/guards/src/__fixtures__/canary';

export interface SourceFile {
  /** Repo-relative, forward-slashed. */
  readonly path: string;
  readonly text: string;
}

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface ReadTreeOptions {
  /** Repo-relative directories to walk. Missing directories are skipped. */
  readonly dirs: readonly string[];
  /** File extensions to keep, with the dot. Omit to keep every file. */
  readonly extensions?: readonly string[];
  /** Repo-relative path predicate applied after the extension filter. */
  readonly exclude?: (path: string) => boolean;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function walk(absDir: string, out: string[]): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      walk(join(absDir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(absDir, entry.name));
    }
  }
}

const treeCache = new Map<string, SourceFile[]>();

/** Read a set of directories into memory once per Jest worker. Guards share the
 * cache, so a full nine-guard run reads the tree a handful of times, not sixty. */
export function readTree(options: ReadTreeOptions): SourceFile[] {
  const key = JSON.stringify([options.dirs, options.extensions]);
  let files = treeCache.get(key);
  if (!files) {
    const absolutePaths: string[] = [];
    for (const dir of options.dirs) {
      const abs = join(REPO_ROOT, dir);
      try {
        if (statSync(abs).isDirectory()) walk(abs, absolutePaths);
        else absolutePaths.push(abs);
      } catch {
        continue;
      }
    }
    files = absolutePaths
      .map((abs) => toPosix(relative(REPO_ROOT, abs)))
      .filter((path) => !path.startsWith(CANARY_DIR))
      .filter((path) => !options.extensions || options.extensions.some((ext) => path.endsWith(ext)))
      .sort()
      .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') }));
    treeCache.set(key, files);
  }
  return options.exclude ? files.filter((file) => !options.exclude?.(file.path)) : files;
}

/** Read one repo-relative file. Returns an empty string when it is absent, so a
 * guard reports a violation rather than throwing an unreadable stack. */
export function readRepoFile(path: string): string {
  try {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
  } catch {
    return '';
  }
}

/** Load the canary fixtures for one guard. The directory name matches the guard
 * spec's basename, so a guard and its canary cannot drift apart silently. */
export function readCanary(guardName: string): SourceFile[] {
  const dir = join(REPO_ROOT, CANARY_DIR, guardName);
  const absolutePaths: string[] = [];
  walk(dir, absolutePaths);
  if (absolutePaths.length === 0) {
    throw new Error(
      `No canary fixture for guard "${guardName}". Every guard ships a fixture that proves it can fail: add one under ${CANARY_DIR}/${guardName}/.`,
    );
  }
  return absolutePaths.sort().map((abs) => ({
    // Canary files are reported under the path the fixture declares, so a guard
    // that keys on path shape (admin lane, storefront lane, e2e lane) behaves
    // the same on a fixture as it does on the real tree.
    path: toPosix(relative(join(REPO_ROOT, CANARY_DIR, guardName), abs)),
    text: readFileSync(abs, 'utf8'),
  }));
}

/** 1-indexed line number of a character offset. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/** True when the line holding this offset is a comment line. Deliberately
 * line-shaped rather than a parser: a guard that wants to ignore prose only
 * ever needs to ignore a line that opens with a comment marker. */
export function isCommentLine(text: string, index: number): boolean {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  const line = text.slice(start, end).trimStart();
  return line.startsWith('//') || line.startsWith('*') || line.startsWith('/*');
}

export interface MatchOptions {
  /** Drop matches that sit on a comment line. Guards about code behaviour want
   * this; guards about markers written in prose do not. */
  readonly skipComments?: boolean;
}

/** Every match of a global regex, as violations. */
export function matchAll(
  file: SourceFile,
  pattern: RegExp,
  message: (match: RegExpExecArray) => string,
  options: MatchOptions = {},
): Violation[] {
  const regex = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  const found: Violation[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(file.text)) !== null) {
    if (!options.skipComments || !isCommentLine(file.text, match.index)) {
      found.push({
        file: file.path,
        line: lineAt(file.text, match.index),
        message: message(match),
      });
    }
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }
  return found;
}

/** Jest prints this when a guard is red. One line per violation, clickable. */
export function report(violations: readonly Violation[]): string {
  return violations.map((v) => `  ${v.file}:${v.line}  ${v.message}`).join('\n');
}

/** The assertion every guard ends with. Keeps the failure output identical
 * across guards and keeps the diff of a new guard down to its check function. */
export function expectNoViolations(violations: readonly Violation[]): void {
  if (violations.length > 0) {
    throw new Error(`${violations.length} violation(s):\n${report(violations)}`);
  }
}
