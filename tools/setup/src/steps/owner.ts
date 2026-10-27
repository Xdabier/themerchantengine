import { isEmail, type Step } from './types';

export const OWNER_PASSWORD_MIN_LENGTH = 12;

/**
 * The owner password committed in ci/answers.local.json for the CI install
 * smoke. It is public, so it is safe only where the local profile binds every
 * port to the loopback interface; every other profile refuses it by value,
 * because the document is the obvious template to copy for a server.
 */
export const CI_SMOKE_OWNER_PASSWORD = 'Ci_Install_Smoke_Password1';

/** Stricter than `create-admin.ts` (which checks the length only), so the runner cannot be refused later. */
export function passwordPolicy(value: string): string | null {
  if (value.length < OWNER_PASSWORD_MIN_LENGTH)
    return `at least ${OWNER_PASSWORD_MIN_LENGTH} characters`;
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'a lower-case letter, an upper-case letter and a digit';
  }
  return null;
}

/**
 * The admin owner account (plan E4.3): the first Super Admin, created by the
 * runner through the non-interactive `create-admin` path. The password is a
 * secret answer: it reaches the runner and never the state file.
 */
export const ownerStep: Step = {
  id: 'owner',
  title: 'Admin owner account',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const owner = ctx.answers.owner ?? {};
    const email = await ctx.prompter.text({
      path: 'owner.email',
      label: 'Owner email (the first admin login)',
      initial: owner.email ?? ctx.answers.identity?.contactEmail,
      validate: (v) => (isEmail(v) ? null : 'not an email address'),
    });
    const firstName = await ctx.prompter.text({
      path: 'owner.firstName',
      label: 'First name',
      initial: owner.firstName ?? 'Store',
      validate: (v) => (v.trim().length > 0 ? null : 'required'),
    });
    const lastName = await ctx.prompter.text({
      path: 'owner.lastName',
      label: 'Last name',
      initial: owner.lastName ?? 'Owner',
      validate: (v) => (v.trim().length > 0 ? null : 'required'),
    });
    const local = ctx.answers.profile === 'local';
    const password = await ctx.prompter.secret({
      path: 'owner.password',
      label: `Password (${OWNER_PASSWORD_MIN_LENGTH}+ characters, mixed case, a digit)`,
      initial: owner.password,
      validate: (value) =>
        !local && value === CI_SMOKE_OWNER_PASSWORD
          ? 'this is the public password committed in ci/answers.local.json for the CI install smoke; choose your own'
          : passwordPolicy(value),
    });
    ctx.answers.owner = { email: email.toLowerCase(), firstName, lastName, password };
  },
};
