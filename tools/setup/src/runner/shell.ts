import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Output } from '../cli/ui';

/**
 * Everything the install runner does to the box goes through this port
 * (plan E4.4): commands, files, HTTP probes, waiting. The real shell runs
 * them, the dry-run shell prints them, and the recording shell in the specs
 * asserts them. A runner step never touches `child_process` or `fs` itself.
 */
export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Fed to stdin, then closed. */
  input?: string;
  /** Capture stdout instead of streaming it to the terminal. */
  capture?: boolean;
  /** Prefix with sudo on a Unix box; a no-op elsewhere. */
  sudo?: boolean;
  /** Return a non-zero exit as a result rather than throwing. */
  allowFailure?: boolean;
}

export interface CommandResult {
  code: number;
  stdout: string;
}

export class CommandFailed extends Error {
  constructor(
    readonly command: string,
    readonly code: number,
  ) {
    super(`${command} exited with ${code}`);
  }
}

export interface Shell {
  run(cmd: string, args: readonly string[], opts?: RunOptions): Promise<CommandResult>;
  writeFile(file: string, content: string, mode?: number): void;
  copyFile(from: string, to: string): void;
  mkdir(dir: string): void;
  exists(file: string): boolean;
  readFile(file: string): string;
  readBinary(file: string): Buffer;
  /** GET with no redirect following; resolves to the status (0 when the socket fails), the body and the lower-cased headers. */
  probe(url: string): Promise<{ status: number; body: string; headers: Record<string, string> }>;
  sleep(ms: number): Promise<void>;
  readonly platform: NodeJS.Platform;
  /** `uid:gid` of the user running setup; undefined where the OS has none (Windows). */
  readonly hostUser?: string;
  /** True when nothing runs: a step that waits on a container's answer returns at once. */
  readonly dryRun: boolean;
}

export function describeCommand(
  cmd: string,
  args: readonly string[],
  opts: RunOptions = {},
): string {
  const env = opts.env
    ? `${Object.keys(opts.env)
        .map((k) => `${k}=…`)
        .join(' ')} `
    : '';
  const sudo = opts.sudo && process.platform !== 'win32' ? 'sudo ' : '';
  return `${sudo}${env}${cmd} ${args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ')}`.trim();
}

function processUser(): string | undefined {
  return process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : undefined;
}

export function realShell(out: Output): Shell {
  return {
    platform: process.platform,
    hostUser: processUser(),
    dryRun: false,
    run(cmd, args, opts = {}) {
      const useSudo = opts.sudo && process.platform !== 'win32';
      const file = useSudo ? 'sudo' : cmd;
      const argv = useSudo ? [cmd, ...args] : [...args];
      out.write(`  $ ${describeCommand(cmd, args, opts)}\n`);
      return new Promise((resolve, reject) => {
        const child = spawn(file, argv, {
          cwd: opts.cwd,
          env: { ...process.env, ...(opts.env ?? {}) },
          stdio: [
            opts.input !== undefined ? 'pipe' : 'inherit',
            opts.capture ? 'pipe' : 'inherit',
            'inherit',
          ],
          shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(file),
        });
        let stdout = '';
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        if (opts.input !== undefined) {
          child.stdin?.end(opts.input);
        }
        child.on('error', reject);
        child.on('close', (code) => {
          const exit = code ?? 1;
          if (exit !== 0 && !opts.allowFailure) {
            reject(new CommandFailed(describeCommand(cmd, args), exit));
            return;
          }
          resolve({ code: exit, stdout });
        });
      });
    },
    writeFile(file, content, mode) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, mode === undefined ? {} : { mode });
      if (mode !== undefined) fs.chmodSync(file, mode);
    },
    copyFile(from, to) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    },
    mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    exists: (file) => fs.existsSync(file),
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    readBinary: (file) => fs.readFileSync(file),
    async probe(url) {
      try {
        const response = await fetch(url, { redirect: 'manual' });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        return { status: response.status, body: await response.text(), headers };
      } catch {
        return { status: 0, body: '', headers: {} };
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * A secret-shaped env line: the name ends in SECRET, PASSWORD, KEY or TOKEN,
 * or is a DATABASE_URL, which carries the password inside it. The dry run
 * prints every file it would write, and an env file is mostly secrets.
 */
const SECRET_LINE = /^((?:[A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|KEY|TOKEN)S?)|DATABASE_URL)=(.*)$/gm;

export function redactSecrets(content: string): string {
  return content.replace(SECRET_LINE, (_line, name: string, value: string) =>
    value === '""' || value === '' ? `${name}=${value}` : `${name}="…redacted…"`,
  );
}

/** Prints every command and file the run would produce; runs and writes nothing. */
export function dryRunShell(
  out: Output,
  base: Pick<Shell, 'exists' | 'readFile' | 'readBinary'>,
): Shell {
  return {
    platform: process.platform,
    hostUser: processUser(),
    dryRun: true,
    async run(cmd, args, opts = {}) {
      out.write(`  [dry-run] $ ${describeCommand(cmd, args, opts)}\n`);
      if (opts.input !== undefined)
        out.write(`  [dry-run]   (stdin: ${opts.input.length} bytes)\n`);
      return { code: 0, stdout: '' };
    },
    writeFile(file, content, mode) {
      out.write(`  [dry-run] write ${file} (${content.length} bytes)\n`);
      // A 0600 file is how the runner marks a secret-bearing file, and on an
      // installed box the content is the live secrets read back from disk.
      // Withheld whole; anything else is printed with secret-shaped lines
      // redacted, so a config file that names a key still shows its shape.
      if (mode !== undefined && (mode & 0o077) === 0) {
        out.write('  | (contents withheld: this file carries secrets)\n');
        return;
      }
      out.write(`${redactSecrets(content).replace(/^/gm, '  | ')}\n`);
    },
    copyFile(from, to) {
      out.write(`  [dry-run] copy ${from} -> ${to}\n`);
    },
    mkdir(dir) {
      out.write(`  [dry-run] mkdir ${dir}\n`);
    },
    exists: base.exists,
    readFile: base.readFile,
    readBinary: base.readBinary,
    async probe(url) {
      out.write(`  [dry-run] GET ${url}\n`);
      return { status: 200, body: '', headers: {} };
    },
    async sleep() {
      /* a dry run does not wait */
    },
  };
}
