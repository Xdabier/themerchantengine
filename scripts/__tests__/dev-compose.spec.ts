/**
 * The dev compose stack (plan O6.6). A port mapping without a host address
 * binds 0.0.0.0, which puts the dev and test Postgres (password `postgres`)
 * and both Redis instances (no auth) on every interface of the machine, so a
 * laptop on a shared network serves them to the whole LAN. Every mapping
 * names the loopback address. The serve logs of the stack preflight can hold
 * request lines and tokens, so the script says the log dir stays local.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const COMPOSE = path.join(REPO, 'docker-compose.yml');
const STACK_CHECK = path.join(REPO, 'scripts', 'stack-check.sh');

function portMappings(): string[] {
  const lines = fs.readFileSync(COMPOSE, 'utf8').split('\n');
  const mappings: string[] = [];
  let inPorts = false;
  for (const line of lines) {
    if (/^\s+ports:\s*$/.test(line)) {
      inPorts = true;
      continue;
    }
    const item = line.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
    if (inPorts && item) {
      mappings.push(item[1]);
      continue;
    }
    inPorts = false;
  }
  return mappings;
}

describe('docker-compose.yml', () => {
  it('maps the four dev and test ports, each bound to the loopback address', () => {
    const mappings = portMappings();
    expect(mappings.map((m) => m.split(':').slice(-2).join(':')).sort()).toEqual([
      '55432:5432',
      '55433:5432',
      '56379:6379',
      '56380:6379',
    ]);
    for (const mapping of mappings) {
      expect(mapping, mapping).toMatch(/^127\.0\.0\.1:\d+:\d+$/);
    }
  });

  it('carries no em-dash or arrow in its header', () => {
    expect(fs.readFileSync(COMPOSE, 'utf8')).not.toMatch(/[—→]/);
  });
});

describe('scripts/stack-check.sh', () => {
  it('documents the serve log dir as local-only', () => {
    const header = fs.readFileSync(STACK_CHECK, 'utf8').split('\n').slice(0, 20).join('\n');
    expect(header).toMatch(/STACK_CHECK_LOG_DIR.*\n.*(local only|local-only|never committed)/i);
  });
});
