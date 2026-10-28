/**
 * The files an operator or a systemd unit runs directly carry the executable
 * bit in the index. A checkout on a filesystem without modes (NTFS) commits
 * them as 100644, and `./setup.sh` then exits 126 on every fresh clone.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');

const EXECUTABLES = [
  'deploy/demo-render/entrypoint.sh',
  'deploy/scripts/rollback.sh',
  'deploy/shared/cert-expiry-alert.sh',
  'deploy/shared/certbot-renew.sh',
  'deploy/shared/install-cert-renew-timer.sh',
  'setup.sh',
];

function indexModes(): Map<string, string> {
  const out = execFileSync('git', ['ls-files', '-s'], { cwd: REPO, encoding: 'utf8' });
  const modes = new Map<string, string>();
  for (const line of out.split('\n').filter(Boolean)) {
    const [meta, file] = line.split('\t');
    modes.set(file, meta.split(' ')[0]);
  }
  return modes;
}

describe('file modes in the index', () => {
  const modes = indexModes();

  it('marks every directly run script executable', () => {
    for (const file of EXECUTABLES) {
      expect(modes.get(file), file).toBe('100755');
    }
  });

  it('marks nothing else executable', () => {
    const executable = [...modes].filter(([, mode]) => mode === '100755').map(([file]) => file);
    expect(executable.sort()).toEqual([...EXECUTABLES].sort());
  });
});
