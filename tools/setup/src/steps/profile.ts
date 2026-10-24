import { SETUP_PROFILES, type SetupProfile } from '../answers';
import type { Step } from './types';

export const PROFILE_LABELS: Record<SetupProfile, string> = {
  engine: 'engine: the API, the admin, Postgres and Redis on this box',
  storefront: 'storefront: the Nitro storefront on this box, against an engine elsewhere',
  both: 'both: engine and storefront on this one box, behind one edge',
  local: 'local: everything on this machine, no TLS, the 53xxx ports, for development',
};

/** The first step: what this box runs. `--profile` answers it without asking. */
export const profileStep: Step = {
  id: 'profile',
  title: 'Profile and box role',
  async run(ctx) {
    const profile = await ctx.prompter.select<SetupProfile>({
      path: 'profile',
      label: 'What does this box run?',
      initial: ctx.answers.profile,
      choices: SETUP_PROFILES.map((value) => ({ value, label: PROFILE_LABELS[value] })),
    });
    ctx.answers.profile = profile;
  },
};
