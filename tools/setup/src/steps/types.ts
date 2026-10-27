import type { SetupAnswers, SetupProfile } from '../answers';
import type { Prompter } from '../cli/prompter';
import type { Output } from '../cli/ui';
import type { Ports } from '../ports';

/**
 * One step of the stepper (plan E4.3). A step reads and fills `answers`
 * through the prompter and verifies through the ports; it never touches the
 * network, the disk or the clock itself, so its spec can drive it end to end
 * with a scripted prompter and fake ports.
 */
export interface StepContext {
  answers: SetupAnswers;
  prompter: Prompter;
  out: Output;
  ports: Ports;
  root: string;
  dryRun: boolean;
}

export interface Step {
  id: string;
  title: string;
  /** Which profiles ask this step; every profile when omitted. */
  profiles?: readonly SetupProfile[];
  run(ctx: StepContext): Promise<void>;
}

export class StepFailed extends Error {
  constructor(
    readonly stepId: string,
    message: string,
  ) {
    super(message);
  }
}

export const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const isHttpsOrigin = (value: string): boolean => /^https:\/\/[a-z0-9.-]+$/.test(value);
export const isAnyOrigin = (value: string): boolean =>
  /^https?:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/.test(value);
export const isHostname = (value: string): boolean =>
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value);
export const isHexColor = (value: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(value);
export const isE164 = (value: string): boolean => /^\+[1-9][0-9]{6,14}$/.test(value);
export const isCountryCode = (value: string): boolean => /^[A-Z]{2}$/.test(value);
export const isCurrencyCode = (value: string): boolean => /^[A-Z]{3}$/.test(value);
