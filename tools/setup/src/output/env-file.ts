import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Reads and writes the engine's environment files (plan E4.2).
 *
 * Three readers consume what this writes: the API's dotenv loader, Docker
 * Compose's `env_file`, and a shell doing `set -a; source`. The one quoting
 * they all agree on is double quotes with `\"` and `\\` escapes. Two
 * characters they do not agree on are refused rather than escaped: `$`
 * (interpolated by the shell and by Compose, literal to dotenv) and a
 * backtick (a command substitution to the shell). A newline is refused for
 * the same reason. The 2026-09 production deploy lost an afternoon to one
 * unquoted space on line 65 of a hand-edited file; the spec here proves the
 * round trip through a real shell.
 */
export interface EnvEntry {
  key: string;
  value: string;
  /** Written above the entry as `# ...` lines. */
  comment?: string;
}

export interface EnvSection {
  title: string;
  entries: EnvEntry[];
}

const KEY = /^[A-Z][A-Z0-9_]*$/;
const REFUSED = /[$`\r\n]/;

export class EnvValueError extends Error {
  constructor(key: string, reason: string) {
    super(`${key}: ${reason}`);
  }
}

export function quoteEnvValue(key: string, value: string): string {
  if (!KEY.test(key)) throw new EnvValueError(key, 'is not a valid environment variable name');
  if (REFUSED.test(value)) {
    throw new EnvValueError(
      key,
      'a value cannot contain $, a backtick or a line break; the shell, Compose and dotenv read those three differently',
    );
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function serializeEnv(sections: readonly EnvSection[], header: string): string {
  const lines: string[] = [];
  for (const line of header.split('\n')) lines.push(line ? `# ${line}` : '#');
  for (const section of sections) {
    lines.push('', `# ── ${section.title} ${'─'.repeat(Math.max(0, 70 - section.title.length))}`);
    for (const entry of section.entries) {
      if (entry.comment) for (const c of entry.comment.split('\n')) lines.push(`# ${c}`);
      lines.push(`${entry.key}=${quoteEnvValue(entry.key, entry.value)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Reads a file this module wrote, or a hand-written one with unquoted or
 * single-quoted values. Escapes are honoured only inside double quotes, which
 * is dotenv's rule too.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"')) {
      let i = 1;
      let acc = '';
      while (i < value.length && value[i] !== '"') {
        if (value[i] === '\\' && i + 1 < value.length) {
          acc += value[i + 1];
          i += 2;
        } else {
          acc += value[i];
          i += 1;
        }
      }
      value = acc;
    } else if (value.startsWith("'")) {
      const end = value.indexOf("'", 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function readEnvFile(file: string): Record<string, string> {
  return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
}

/** Mode 0600 and a rename, so a crash cannot leave a half-written secret file readable. */
export function writeEnvFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}
