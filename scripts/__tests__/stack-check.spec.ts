/**
 * The stack preflight (plan O5.6). The phase protocol used to carry a prose
 * checklist (docker ps, curl the API, curl the admin) that every session
 * re-read and half of them skipped. `scripts/stack-check.sh` is the checklist
 * as code: it checks the docker containers, the API health endpoint and the
 * admin dev server, starts whatever is down, waits for it, and exits non-zero
 * when a service never answers.
 *
 * The script runs in a sandbox with fake `docker`, `curl`, `npm` and `npx`
 * commands first on PATH. The fakes keep their state in files, so "the API
 * came up after `nx serve api`" is a file the fake `npx` creates and the fake
 * `curl` looks for.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const REPO = join(__dirname, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'stack-check.sh');

const CONTAINERS = [
  'merchants-engine-postgres-dev',
  'merchants-engine-postgres-test',
  'merchants-engine-redis-dev',
  'merchants-engine-redis-test',
];

const FAKE_DOCKER = [
  '#!/usr/bin/env bash',
  'printf "docker %s\\n" "$*" >> "$FAKE_LOG"',
  'if [ -n "${FAKE_DOCKER_DOWN:-}" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi',
  '[ -f "$FAKE_STATE/containers" ] && cat "$FAKE_STATE/containers"',
  'exit 0',
  '',
].join('\n');

// The URL is the last argument. Its last path segment names the service.
const FAKE_CURL = [
  '#!/usr/bin/env bash',
  'for a in "$@"; do url="$a"; done',
  'name="${url##*/}"',
  'printf "curl %s\\n" "$name" >> "$FAKE_LOG"',
  '[ -f "$FAKE_STATE/$name" ] && exit 0',
  'exit 7',
  '',
].join('\n');

const FAKE_NPM = [
  '#!/usr/bin/env bash',
  'printf "npm %s\\n" "$*" >> "$FAKE_LOG"',
  'case "$*" in *docker:up*) printf "%s\\n" ' +
    CONTAINERS.map((c) => `"${c}"`).join(' ') +
    ' > "$FAKE_STATE/containers" ;; esac',
  'exit 0',
  '',
].join('\n');

const FAKE_NPX = [
  '#!/usr/bin/env bash',
  'printf "npx %s\\n" "$*" >> "$FAKE_LOG"',
  'case "$*" in',
  '  *"serve api"*) [ "${FAKE_NEVER_UP:-}" = api ] || touch "$FAKE_STATE/api" ;;',
  '  *"serve admin"*) [ "${FAKE_NEVER_UP:-}" = admin ] || touch "$FAKE_STATE/admin" ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

let dir: string;
let state: string;
let log: string;

function up(...names: string[]) {
  for (const n of names) writeFileSync(join(state, n), '');
}

function containersUp() {
  writeFileSync(join(state, 'containers'), CONTAINERS.join('\n') + '\n');
}

function run(args: string[] = [], extraEnv: Record<string, string> = {}) {
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const r = spawnSync('bash', [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      [pathKey]: `${join(dir, 'bin')}${delimiter}${process.env[pathKey] ?? ''}`,
      FAKE_LOG: log,
      FAKE_STATE: state,
      STACK_CHECK_API_URL: 'http://fake/api',
      STACK_CHECK_ADMIN_URL: 'http://fake/admin',
      STACK_CHECK_LOG_DIR: join(dir, 'logs').replace(/\\/g, '/'),
      STACK_CHECK_TIMEOUT: '3',
      STACK_CHECK_INTERVAL: '1',
      ...extraEnv,
    },
    input: '',
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

function calls(prefix: string): string[] {
  try {
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith(prefix));
  } catch {
    return [];
  }
}

beforeEach(() => {
  // Git Bash reads the Windows temp path once it is forward-slashed.
  dir = mkdtempSync(join(tmpdir(), 'stack-check-')).replace(/\\/g, '/');
  state = `${dir}/state`;
  log = `${dir}/calls.log`;
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(state);
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), FAKE_CURL, { mode: 0o755 });
  writeFileSync(join(bin, 'npm'), FAKE_NPM, { mode: 0o755 });
  writeFileSync(join(bin, 'npx'), FAKE_NPX, { mode: 0o755 });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

it('parses', () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
});

describe('everything already up', () => {
  it('reports each service and starts nothing', () => {
    containersUp();
    up('api', 'admin');
    const { status, out } = run();
    expect(status).toBe(0);
    expect(out).toMatch(/docker.*ok/);
    expect(out).toMatch(/api.*ok/);
    expect(out).toMatch(/admin.*ok/);
    expect(calls('npm ')).toEqual([]);
    expect(calls('npx ')).toEqual([]);
  });
});

describe('starting what is down', () => {
  it('starts the API and the admin in the background and waits for both', () => {
    containersUp();
    const { status, out } = run();
    expect(status).toBe(0);
    // Both serves are detached, so their log order is a race under load.
    expect(calls('npx ').sort()).toEqual(['npx nx serve admin', 'npx nx serve api']);
    expect(out).toMatch(/api.*up/);
    expect(out).toMatch(/admin.*up/);
    expect(existsSync(join(dir, 'logs', 'api-serve.log'))).toBe(true);
    expect(existsSync(join(dir, 'logs', 'admin-serve.log'))).toBe(true);
  });

  it('starts only what is down', () => {
    containersUp();
    up('api');
    expect(run().status).toBe(0);
    expect(calls('npx ')).toEqual(['npx nx serve admin']);
  });

  it('brings the containers up with npm run docker:up before the API', () => {
    up('api', 'admin');
    const { status, out } = run();
    expect(status).toBe(0);
    expect(calls('npm ')).toEqual(['npm run docker:up']);
    expect(out).toMatch(/docker.*up/);
    // The compose file names every container; a missing one is "down".
    expect(out).not.toMatch(/FAILED/);
  });

  it('treats a missing container as down even when the others run', () => {
    writeFileSync(join(state, 'containers'), CONTAINERS.slice(0, 3).join('\n') + '\n');
    up('api', 'admin');
    expect(run().status).toBe(0);
    expect(calls('npm ')).toEqual(['npm run docker:up']);
  });
});

describe('failure', () => {
  it('exits non-zero and names the service when it never comes up', () => {
    containersUp();
    up('api');
    const { status, out } = run([], { FAKE_NEVER_UP: 'admin' });
    expect(status).toBe(1);
    expect(out).toMatch(/FAILED.*admin/);
    expect(out).toContain('admin-serve.log');
  });

  it('exits non-zero without starting anything when the docker daemon is unreachable', () => {
    up('api', 'admin');
    const { status, out } = run([], { FAKE_DOCKER_DOWN: '1' });
    expect(status).toBe(1);
    expect(out).toMatch(/FAILED.*docker/);
    expect(calls('npm ')).toEqual([]);
    expect(calls('npx ')).toEqual([]);
  });

  it('refuses a timeout or interval that is not a whole number of seconds', () => {
    // Both land in shell arithmetic, which evaluates what it is given.
    containersUp();
    up('api', 'admin');
    for (const env of [{ STACK_CHECK_INTERVAL: 'x' }, { STACK_CHECK_TIMEOUT: '1+a[$(id)]' }]) {
      const { status, out } = run([], env);
      expect(status).toBe(2);
      expect(out).toContain('must be whole seconds');
      expect(calls('npm ')).toEqual([]);
      expect(calls('npx ')).toEqual([]);
    }
  });
});

describe('--check-only', () => {
  it('reports what is down, starts nothing, and exits non-zero', () => {
    containersUp();
    up('api');
    const { status, out } = run(['--check-only']);
    expect(status).toBe(1);
    expect(out).toMatch(/admin.*down/);
    expect(calls('npx ')).toEqual([]);
  });

  it('exits zero when everything is up', () => {
    containersUp();
    up('api', 'admin');
    expect(run(['--check-only']).status).toBe(0);
  });
});
