import { SETUP_PROFILES, type SetupProfile } from '../answers';

/** What the wrappers and the operator can pass on the command line (plan E4.2). */
export interface SetupArgs {
  profile: SetupProfile | null;
  /** Path of a JSON answers document for a non-interactive run. */
  answersFile: string | null;
  /** Print every file and command the run would produce, write and run nothing. */
  dryRun: boolean;
  /** Path of the resumable state file. */
  stateFile: string;
  /** The repository root the run installs from. */
  root: string;
  /** Start over: ignore the state file's completed steps and stored answers. */
  reset: boolean;
  help: boolean;
  version: boolean;
}

export const DEFAULT_STATE_FILE = '.setup-state.json';

export const USAGE = `themerchantengine setup

Usage: node tools/setup/dist/index.js [options]

Options:
  --profile <engine|storefront|both|local>  What this box runs. Asked when omitted.
  --local                                   Shorthand for --profile local.
  --answers <file.json>                     Non-interactive run from an answers document.
  --dry-run                                 Print every file and command; write and run nothing.
  --state <file>                            Resumable state file (default ${DEFAULT_STATE_FILE}).
  --root <dir>                              Repository root (default: the current directory).
  --reset                                   Ignore the state file and start over.
  --help                                    This text.
  --version                                 The engine version.
`;

export class ArgsError extends Error {}

export function parseArgs(argv: readonly string[], cwd: string): SetupArgs {
  const args: SetupArgs = {
    profile: null,
    answersFile: null,
    dryRun: false,
    stateFile: DEFAULT_STATE_FILE,
    root: cwd,
    reset: false,
    help: false,
    version: false,
  };
  const rest = [...argv];
  const takeValue = (flag: string): string => {
    const value = rest.shift();
    if (value === undefined || value.startsWith('--')) throw new ArgsError(`${flag} needs a value`);
    return value;
  };
  while (rest.length > 0) {
    const flag = rest.shift() as string;
    const [name, inline] = flag.includes('=') ? flag.split(/=(.*)/s, 2) : [flag, undefined];
    if (inline !== undefined) rest.unshift(inline);
    switch (name) {
      case '--profile': {
        const value = takeValue(name);
        if (!(SETUP_PROFILES as readonly string[]).includes(value)) {
          throw new ArgsError(
            `--profile must be one of ${SETUP_PROFILES.join(', ')}, got ${value}`,
          );
        }
        args.profile = value as SetupProfile;
        break;
      }
      case '--local':
        args.profile = 'local';
        break;
      case '--answers':
        args.answersFile = takeValue(name);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--state':
        args.stateFile = takeValue(name);
        break;
      case '--root':
        args.root = takeValue(name);
        break;
      case '--reset':
        args.reset = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--version':
        args.version = true;
        break;
      default:
        throw new ArgsError(`unknown option ${name}`);
    }
  }
  return args;
}
