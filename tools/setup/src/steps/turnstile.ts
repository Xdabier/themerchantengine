import { ui } from '../cli/ui';
import { StepFailed, type Step } from './types';

/**
 * Cloudflare Turnstile (plan E4.3, mandatory on a server profile): the
 * public site key the storefront renders and the secret the API verifies
 * with. The secret is proven against siteverify before the step passes. A
 * local profile leaves it off, which keeps sign-up open for development.
 */
export const turnstileStep: Step = {
  id: 'turnstile',
  title: 'Sign-up bot protection (Turnstile)',
  async run(ctx) {
    const turnstile = ctx.answers.turnstile ?? {};
    if (ctx.answers.profile === 'storefront') {
      // The secret lives on the engine box; this box renders the widget only.
      const siteKey = await ctx.prompter.text({
        path: 'turnstile.siteKey',
        label:
          'Turnstile site key the engine was configured with (public, empty if the engine runs without Turnstile)',
        initial: turnstile.siteKey ?? '',
        validate: (v) =>
          v === '' || (v.startsWith('0x') && v.length > 10)
            ? null
            : 'a Turnstile site key starts with 0x',
      });
      ctx.answers.turnstile = { enabled: siteKey !== '', siteKey };
      return;
    }
    if (ctx.answers.profile === 'local') {
      const enabled = await ctx.prompter.confirm({
        path: 'turnstile.enabled',
        label: 'Enable Turnstile locally? (needs a widget configured for localhost)',
        initial: turnstile.enabled ?? false,
      });
      if (!enabled) {
        ctx.answers.turnstile = { enabled: false };
        ui.note(ctx.out, 'local profile: sign-up runs without a captcha');
        return;
      }
    }
    const siteKey = await ctx.prompter.text({
      path: 'turnstile.siteKey',
      label: 'Turnstile site key (public)',
      initial: turnstile.siteKey,
      validate: (v) =>
        v.startsWith('0x') && v.length > 10 ? null : 'a Turnstile site key starts with 0x',
    });
    const secretKey = await ctx.prompter.secret({
      path: 'turnstile.secretKey',
      label: 'Turnstile secret key',
      initial: turnstile.secretKey,
      validate: (v) =>
        v.startsWith('0x') && v.length > 10 ? null : 'a Turnstile secret starts with 0x',
    });
    ctx.answers.turnstile = { enabled: true, siteKey, secretKey };
    if (ctx.dryRun) {
      ui.note(ctx.out, 'dry run: the siteverify check is skipped');
      return;
    }
    let accepted: boolean;
    try {
      accepted = await ctx.ports.turnstileSecretAccepted(secretKey);
    } catch (err) {
      throw new StepFailed('turnstile', (err as Error).message);
    }
    if (!accepted) throw new StepFailed('turnstile', 'Cloudflare refused the secret key');
    ui.ok(ctx.out, 'Cloudflare accepted the secret key');
  },
};
