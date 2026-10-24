import { describe, expect, it } from 'vitest';
import { ArgsError, DEFAULT_STATE_FILE, parseArgs } from './args';

describe('parseArgs', () => {
  it('defaults to an interactive run from the current directory', () => {
    expect(parseArgs([], '/srv/engine')).toEqual({
      profile: null,
      answersFile: null,
      dryRun: false,
      stateFile: DEFAULT_STATE_FILE,
      root: '/srv/engine',
      reset: false,
      help: false,
      version: false,
    });
  });

  it('reads every option, in both --flag value and --flag=value forms', () => {
    const args = parseArgs(
      [
        '--profile',
        'both',
        '--answers=ci/answers.json',
        '--dry-run',
        '--state',
        's.json',
        '--root=/x',
        '--reset',
      ],
      '/cwd',
    );
    expect(args).toMatchObject({
      profile: 'both',
      answersFile: 'ci/answers.json',
      dryRun: true,
      stateFile: 's.json',
      root: '/x',
      reset: true,
    });
  });

  it('treats --local as --profile local', () => {
    expect(parseArgs(['--local'], '/cwd').profile).toBe('local');
  });

  it('refuses a profile it does not know', () => {
    expect(() => parseArgs(['--profile', 'cloud'], '/cwd')).toThrow(ArgsError);
    expect(() => parseArgs(['--profile', 'cloud'], '/cwd')).toThrow(
      /engine, storefront, both, local/,
    );
  });

  it('refuses an option it does not know and a value-taking flag with no value', () => {
    expect(() => parseArgs(['--bogus'], '/cwd')).toThrow(/unknown option --bogus/);
    expect(() => parseArgs(['--answers'], '/cwd')).toThrow(/--answers needs a value/);
    expect(() => parseArgs(['--answers', '--dry-run'], '/cwd')).toThrow(/--answers needs a value/);
  });
});
