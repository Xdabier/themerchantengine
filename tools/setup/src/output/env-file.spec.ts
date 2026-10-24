import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EnvValueError,
  parseEnv,
  quoteEnvValue,
  readEnvFile,
  serializeEnv,
  writeEnvFile,
} from './env-file';

const AWKWARD = {
  STORE_NAME: 'Atlas & Sons "Ltd" \\ trading # not a comment',
  WITH_SPACE: 'two words',
  EMPTY: '',
  HEX: 'a1b2c3',
};

function throughBash(file: string, key: string): string {
  // `set -ae; source` is what provision scripts do on a box. The value printed
  // back is the value the shell saw, which is the whole point of the test.
  return execFileSync(
    'bash',
    ['-c', `set -ae; source "$1"; printf '%s' "\${${key}}"`, '--', file],
    {
      encoding: 'utf8',
    },
  );
}

describe('env file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-env-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('quotes every value and refuses the three characters the readers disagree on', () => {
    expect(quoteEnvValue('A', 'two words')).toBe('"two words"');
    expect(quoteEnvValue('A', 'say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"');
    for (const bad of ['a$b', 'a`b', 'a\nb', 'a\rb']) {
      expect(() => quoteEnvValue('A', bad)).toThrow(EnvValueError);
    }
    expect(() => quoteEnvValue('lower', 'x')).toThrow(/not a valid environment variable name/);
  });

  it('round-trips awkward values through its own parser', () => {
    const text = serializeEnv(
      [{ title: 'Test', entries: Object.entries(AWKWARD).map(([key, value]) => ({ key, value })) }],
      'header line\n\nsecond',
    );
    expect(text.startsWith('# header line\n#\n# second\n')).toBe(true);
    expect(parseEnv(text)).toEqual(AWKWARD);
  });

  it('round-trips awkward values through a real shell', () => {
    const file = path.join(dir, '.env.production');
    writeEnvFile(
      file,
      serializeEnv(
        [
          {
            title: 'Test',
            entries: Object.entries(AWKWARD).map(([key, value]) => ({ key, value })),
          },
        ],
        'h',
      ),
    );
    for (const [key, value] of Object.entries(AWKWARD)) {
      expect(throughBash(file, key), key).toBe(value);
    }
  });

  it('proves the shell round trip can fail: an unquoted value with a space breaks source', () => {
    const file = path.join(dir, 'broken.env');
    fs.writeFileSync(file, 'WITH_SPACE=two words\n');
    expect(() => throughBash(file, 'WITH_SPACE')).toThrow();
  });

  it('reads hand-written files: unquoted, single-quoted, exported, commented', () => {
    const parsed = parseEnv(
      [
        '# comment',
        'PLAIN=value',
        "SINGLE='keep \\ as is'",
        'export EXPORTED=yes',
        'TRAILING=value # note',
        'NOEQUALS',
        '',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      PLAIN: 'value',
      SINGLE: 'keep \\ as is',
      EXPORTED: 'yes',
      TRAILING: 'value',
    });
  });

  it('writes with mode 0600 and reads back an absent file as empty', () => {
    const file = path.join(dir, 'x.env');
    expect(readEnvFile(file)).toEqual({});
    writeEnvFile(file, 'A="1"\n');
    expect(readEnvFile(file)).toEqual({ A: '1' });
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
