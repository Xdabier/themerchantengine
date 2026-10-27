/**
 * The two install wrappers (plan E4.1). setup.sh must parse, and setup.ps1
 * must hand no quoted expression to a native command: Windows PowerShell 5.1
 * strips the inner quotes of `node -p '...split(".")...'` before node sees
 * its argument, and the first real run of the wrapper on Windows died on
 * exactly that line. Every value a native command returns is split or
 * compared on the PowerShell side instead.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');

describe('setup.sh', () => {
  it('parses', () => {
    const result = spawnSync('bash', ['-n', 'setup.sh'], { cwd: REPO, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('setup.ps1', () => {
  const text = fs.readFileSync(path.join(REPO, 'setup.ps1'), 'utf8');
  const nativeLines = text
    .split('\n')
    .filter((line) => /^\s*[^#]*\b(node|npm|docker)\b/.test(line) && !/^\s*#/.test(line));

  it('calls node, npm and docker somewhere, or this guard has nothing to protect', () => {
    expect(nativeLines.length).toBeGreaterThan(3);
  });

  it('passes no double quote inside a single-quoted argument to a native command', () => {
    const offenders = nativeLines.filter((line) => /'[^']*"[^']*'/.test(line));
    expect(offenders).toEqual([]);
  });

  it('the rule can fail on the line that broke', () => {
    const broken = `$HaveMajor = (node -p 'process.versions.node.split(".")[0]').Trim()`;
    expect(/'[^']*"[^']*'/.test(broken)).toBe(true);
    const fixed = `$HaveMajor = ((node -p 'process.versions.node').Trim() -split '\\.')[0]`;
    expect(/'[^']*"[^']*'/.test(fixed)).toBe(false);
  });
});
