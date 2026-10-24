import type { CommandResult, RunOptions, Shell } from './shell';

/**
 * A shell for the specs: records every command and file, answers commands
 * from a script, and holds an in-memory filesystem so a second run of the
 * same install sees what the first one wrote.
 */
export interface RecordedCommand {
  cmd: string;
  args: string[];
  opts: RunOptions;
}

export interface RecordingShell extends Shell {
  commands: RecordedCommand[];
  files: Map<string, string>;
  probes: string[];
  /** Answers by a substring of the joined command line; the first match wins. */
  responses: { match: string; result: CommandResult }[];
  probeStatus: number;
  probeBody: string;
  probeHeaders: Record<string, string>;
}

export function recordingShell(
  seedFiles: Record<string, string> = {},
  platform: NodeJS.Platform = 'linux',
  hostUser?: string,
): RecordingShell {
  const shell: RecordingShell = {
    platform,
    hostUser,
    dryRun: false,
    commands: [],
    files: new Map(Object.entries(seedFiles)),
    probes: [],
    // Containers report healthy at once; a spec that needs the wait to fail
    // replaces this entry.
    responses: [
      { match: '{{.State.Health.Status}}', result: { code: 0, stdout: 'healthy\n' } },
      // A fresh store: no user row yet. A re-run spec pushes a count, and the
      // last scripted answer wins.
      { match: 'SELECT count(*) FROM "User"', result: { code: 0, stdout: '0\n' } },
    ],
    probeStatus: 200,
    probeBody: '{"data":{"status":"ok"},"identity":{}}',
    probeHeaders: {
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none';",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    },
    async run(cmd, args, opts = {}) {
      shell.commands.push({ cmd, args: [...args], opts });
      // The SQL a psql call sends travels on stdin, so a scripted answer can
      // match on it as well as on the command line.
      const line = `${cmd} ${args.join(' ')}
${opts.input ?? ''}`;
      const scripted = [...shell.responses].reverse().find((r) => line.includes(r.match));
      return scripted ? scripted.result : { code: 0, stdout: '' };
    },
    writeFile(file, content) {
      shell.files.set(file, content);
    },
    copyFile(from, to) {
      const content = shell.files.get(from);
      if (content === undefined) throw new Error(`recording shell: no file to copy at ${from}`);
      shell.files.set(to, content);
    },
    mkdir() {
      /* directories are implicit in the map */
    },
    exists: (file) => shell.files.has(file),
    readFile(file) {
      const content = shell.files.get(file);
      if (content === undefined) throw new Error(`recording shell: no file at ${file}`);
      return content;
    },
    readBinary: (file) => Buffer.from(shell.readFile(file)),
    async probe(url) {
      shell.probes.push(url);
      return { status: shell.probeStatus, body: shell.probeBody, headers: shell.probeHeaders };
    },
    async sleep() {
      /* never wait in a spec */
    },
  };
  return shell;
}

export function commandLines(shell: RecordingShell): string[] {
  return shell.commands.map((c) => `${c.opts.sudo ? 'sudo ' : ''}${c.cmd} ${c.args.join(' ')}`);
}
