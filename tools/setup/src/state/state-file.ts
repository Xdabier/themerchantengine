import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { setupAnswersSchema, withoutSecrets, type SetupAnswers } from '../answers';

/**
 * The resumable state of a run (plan E4.2): which steps completed and the
 * non-secret answers they collected. Gitignored. A secret never lands here;
 * `withoutSecrets` strips every path listed in `SECRET_ANSWER_PATHS` on the
 * way out, and the spec canaries that with a planted key.
 */
export const STATE_VERSION = 1;

export const setupStateSchema = z
  .object({
    version: z.literal(STATE_VERSION),
    completedSteps: z.array(z.string()),
    answers: setupAnswersSchema,
    updatedAt: z.string(),
  })
  .strict();

export type SetupState = z.infer<typeof setupStateSchema>;

export function emptyState(): SetupState {
  return { version: STATE_VERSION, completedSteps: [], answers: {}, updatedAt: '' };
}

export function readState(file: string): SetupState {
  if (!fs.existsSync(file)) return emptyState();
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  const parsed = setupStateSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${file} is not a state file this version understands (${issue.path.join('.')}: ${issue.message}); delete it or pass --reset`,
    );
  }
  return parsed.data;
}

/** Atomic: a crash mid-write leaves the previous state, never half a file. */
export function writeState(file: string, state: SetupState, now: Date = new Date()): void {
  const persisted: SetupState = {
    ...state,
    answers: withoutSecrets(state.answers),
    updatedAt: now.toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function markCompleted(state: SetupState, stepId: string): SetupState {
  return state.completedSteps.includes(stepId)
    ? state
    : { ...state, completedSteps: [...state.completedSteps, stepId] };
}

export function mergeAnswers(state: SetupState, answers: SetupAnswers): SetupState {
  return { ...state, answers: deepMerge(state.answers, answers) as SetupAnswers };
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (Array.isArray(over) || over === null || typeof over !== 'object') return over;
  const result: Record<string, unknown> = { ...((base as Record<string, unknown>) ?? {}) };
  for (const [key, value] of Object.entries(over as Record<string, unknown>)) {
    result[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? deepMerge(result[key], value)
        : value;
  }
  return result;
}
