import { hostOf } from '../../../../libs/shared/common/src/url';
import { ui } from '../cli/ui';
import { StepFailed, isEmail, type Step } from './types';

/**
 * Transactional mail (plan E4.3): Resend, with the sending domain looked up
 * in the account and a test message delivered to the operator before the
 * step passes. A local profile uses the console transport and redirects
 * every message to one address.
 */
export const mailStep: Step = {
  id: 'mail',
  title: 'Transactional mail',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const mail = ctx.answers.mail ?? {};
    const contact = ctx.answers.identity?.contactEmail;
    if (ctx.answers.profile === 'local') {
      const devRedirectTo = await ctx.prompter.text({
        path: 'mail.devRedirectTo',
        label: 'Address every local email is redirected to',
        initial: mail.devRedirectTo ?? contact,
        validate: (v) => (isEmail(v) ? null : 'not an email address'),
      });
      ctx.answers.mail = {
        transport: 'console',
        fromEmail: mail.fromEmail ?? 'noreply@localhost',
        fromName: mail.fromName ?? ctx.answers.identity?.storeName?.['default'] ?? 'store',
        replyTo: mail.replyTo ?? devRedirectTo,
        contactFormRecipient: mail.contactFormRecipient ?? devRedirectTo,
        devRedirectTo,
      };
      ui.note(ctx.out, 'local profile: console transport, nothing leaves this machine');
      return;
    }

    const apex = hostOf(ctx.answers.domains?.storefront ?? '') ?? '';
    const fromEmail = await ctx.prompter.text({
      path: 'mail.fromEmail',
      label: 'Sender address',
      initial: mail.fromEmail ?? (apex ? `noreply@${apex}` : undefined),
      validate: (v) => (isEmail(v) ? null : 'not an email address'),
    });
    const fromName = await ctx.prompter.text({
      path: 'mail.fromName',
      label: 'Sender display name',
      initial: mail.fromName ?? ctx.answers.identity?.storeName?.['default'],
      validate: (v) => (v.trim().length > 0 ? null : 'required'),
    });
    const replyTo = await ctx.prompter.text({
      path: 'mail.replyTo',
      label: 'Reply-to address',
      initial: mail.replyTo ?? contact,
      validate: (v) => (isEmail(v) ? null : 'not an email address'),
    });
    const contactFormRecipient = await ctx.prompter.text({
      path: 'mail.contactFormRecipient',
      label: 'Where the storefront contact form is delivered',
      initial: mail.contactFormRecipient ?? contact,
      validate: (v) => (isEmail(v) ? null : 'not an email address'),
    });
    const apiKey = await ctx.prompter.secret({
      path: 'mail.apiKey',
      label: 'Resend API key',
      initial: mail.apiKey,
      validate: (v) => (v.startsWith('re_') ? null : 'a Resend key starts with re_'),
    });
    const webhookSecret = await ctx.prompter.secret({
      path: 'mail.webhookSecret',
      label: 'Resend webhook signing secret (whsec_...)',
      initial: mail.webhookSecret,
      hint: `Create the endpoint ${ctx.answers.domains?.api ?? ''}/api/v1/webhooks/resend in the Resend dashboard first.`,
      validate: (v) =>
        v.startsWith('whsec_') ? null : 'a Resend webhook secret starts with whsec_',
    });
    const testRecipient = await ctx.prompter.text({
      path: 'mail.testRecipient',
      label: 'Send the test message to',
      initial: mail.testRecipient ?? contact,
      validate: (v) => (isEmail(v) ? null : 'not an email address'),
    });
    ctx.answers.mail = {
      transport: 'resend',
      apiKey,
      webhookSecret,
      fromEmail,
      fromName,
      replyTo,
      contactFormRecipient,
      testRecipient,
    };
    if (ctx.dryRun) {
      ui.note(ctx.out, 'dry run: the Resend checks are skipped');
      return;
    }
    const domain = fromEmail.split('@')[1];
    let status;
    try {
      status = await ctx.ports.resendDomain(apiKey, domain);
    } catch (err) {
      throw new StepFailed('mail', (err as Error).message);
    }
    if (!status.found) {
      throw new StepFailed(
        'mail',
        `${domain} is not a domain in this Resend account; add it and publish its DNS records`,
      );
    }
    if (status.status !== 'verified') {
      throw new StepFailed(
        'mail',
        `${domain} is ${status.status} in Resend, not verified; publish its DNS records and run setup again`,
      );
    }
    ui.ok(ctx.out, `${domain} is verified in Resend`);
    try {
      const id = await ctx.ports.resendSend(
        apiKey,
        `${fromName} <${fromEmail}>`,
        testRecipient,
        `themerchantengine setup: mail works for ${fromName}`,
        'This message was sent by the install stepper to prove the transactional mail path. Nothing to do.',
      );
      ui.ok(ctx.out, `test message ${id} sent to ${testRecipient}`);
    } catch (err) {
      throw new StepFailed('mail', (err as Error).message);
    }
  },
};
