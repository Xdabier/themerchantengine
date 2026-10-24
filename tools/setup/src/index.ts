import { AnswersError } from './answers';
import { ArgsError, USAGE, parseArgs } from './cli/args';
import { InvalidAnswerError, MissingAnswerError } from './cli/prompter';
import { stdoutOutput, ui } from './cli/ui';
import { realPorts } from './ports/real';
import { runSetup } from './run';
import { InstallFailed } from './runner/install';
import { CommandFailed } from './runner/shell';
import { StepFailed } from './steps/types';
import { ENGINE_VERSION } from './version';

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), process.cwd());
  } catch (err) {
    if (err instanceof ArgsError) {
      process.stderr.write(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`${ENGINE_VERSION}\n`);
    return 0;
  }
  try {
    await runSetup(args, { out: stdoutOutput, ports: realPorts() });
    return 0;
  } catch (err) {
    if (
      err instanceof MissingAnswerError ||
      err instanceof InvalidAnswerError ||
      err instanceof AnswersError
    ) {
      ui.fail(stdoutOutput, err.message);
      return 3;
    }
    if (err instanceof StepFailed) {
      ui.fail(stdoutOutput, `${err.stepId}: ${err.message}`);
      return 4;
    }
    if (err instanceof InstallFailed) {
      ui.fail(stdoutOutput, `${err.stepId}: ${err.message}`);
      ui.note(stdoutOutput, 'fix the cause and run setup again; completed steps are kept');
      return 5;
    }
    if (err instanceof CommandFailed) {
      ui.fail(stdoutOutput, err.message);
      ui.note(stdoutOutput, 'fix the cause and run setup again; completed steps are kept');
      return 6;
    }
    throw err;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
    process.exitCode = 1;
  },
);
