/**
 * Mail-module env validation.
 *
 * Loaded at boot from `apps/api/src/main.ts` so a misconfigured production
 * deploy (e.g. `MAIL_TRANSPORT=resend` without `RESEND_API_KEY`) fails-loud
 * before serving requests, per constitution §3.7.
 */
import { z } from 'zod';
import { isProduction } from '@common/env';
import { MAIL_IDENTITY_DEFAULTS, MAIL_IDENTITY_KEYS } from './mail-identity';
import { MAIL_PUBLIC_HOST_KEYS } from './public-hosts';

export const mailEnvSchema = z
  .object({
    /** `console` (default) logs without sending; `resend` calls the Resend API. */
    MAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),

    /** `re_…` — sending-only key scoped to the verified Resend domain. */
    RESEND_API_KEY: z.string().min(20).optional(),

    /** Bare envelope-from address. The display name is set via `RESEND_FROM_NAME`.
     *  The apex domain verified in Resend (DKIM at
     *  resend._domainkey, MAIL FROM on the send.* subdomain). */
    RESEND_FROM_EMAIL: z.string().email().default(MAIL_IDENTITY_DEFAULTS.fromEmail),

    /** Display name combined with `RESEND_FROM_EMAIL` to build the `From:` header. */
    RESEND_FROM_NAME: z.string().min(1).default(MAIL_IDENTITY_DEFAULTS.fromName),

    /** Default `Reply-To:` header. Per-job overrides supersede this. */
    RESEND_REPLY_TO: z.string().email().default(MAIL_IDENTITY_DEFAULTS.replyTo),

    /** Where the storefront contact form is delivered. */
    CONTACT_FORM_RECIPIENT: z.string().email().default(MAIL_IDENTITY_DEFAULTS.contactRecipient),

    /** `whsec_…` Svix signing secret from the Resend dashboard webhooks page. */
    RESEND_WEBHOOK_SECRET: z.string().min(10).optional(),

    /**
     * Non-production override — when set, every outbound recipient is
     * rerouted to this inbox. Lets staging exercise the real Resend pipeline
     * without spamming customers. Ignored in production.
     */
    MAIL_DEV_REDIRECT_TO: z
      .string()
      .email()
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'resend') {
      if (!env.RESEND_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY is required when MAIL_TRANSPORT=resend',
        });
      }
      if (!env.RESEND_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RESEND_WEBHOOK_SECRET'],
          message: 'RESEND_WEBHOOK_SECRET is required when MAIL_TRANSPORT=resend',
        });
      }
      // NE7 boot-time guard (Risk R11): the dev recipient-redirect MUST be empty
      // when sending for real. `resolveRecipient` ignores it outside prod, but a
      // staging box left on MAIL_TRANSPORT=resend with a stray redirect would
      // silently reroute every customer email to the redirect inbox. Fail loud at
      // boot rather than mis-deliver — the validation `mail.service.ts` promises.
      if (env.MAIL_DEV_REDIRECT_TO) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MAIL_DEV_REDIRECT_TO'],
          message:
            'MAIL_DEV_REDIRECT_TO must be empty when MAIL_TRANSPORT=resend — it would ' +
            'silently reroute real customer mail to the redirect inbox.',
        });
      }
    }
  });

export type MailEnv = z.infer<typeof mailEnvSchema>;

/**
 * Throws a `ZodError` (caught by the caller in main.ts) with the full list of
 * misconfigurations. Caller is expected to log + exit on failure — never
 * silently swallow.
 */
export function validateMailEnv(env: NodeJS.ProcessEnv): MailEnv {
  assertMailIdentitySet(env);
  return mailEnvSchema.parse({
    MAIL_TRANSPORT: env.MAIL_TRANSPORT,
    RESEND_API_KEY: env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL,
    RESEND_FROM_NAME: env.RESEND_FROM_NAME,
    RESEND_REPLY_TO: env.RESEND_REPLY_TO,
    CONTACT_FORM_RECIPIENT: env.CONTACT_FORM_RECIPIENT,
    RESEND_WEBHOOK_SECRET: env.RESEND_WEBHOOK_SECRET,
    MAIL_DEV_REDIRECT_TO: env.MAIL_DEV_REDIRECT_TO,
  });
}

/**
 * In production the mail identity and the public origins must be set
 * explicitly, never defaulted.
 *
 * The defaults above exist so local, test and CI runs need no env file. On a
 * real deployment they are the wrong safety net: an unset variable would send
 * from, and deliver to, an address nobody chose for that box. D1 found exactly
 * that shape of bug — `CONTACT_FORM_RECIPIENT` silently routing a customer's
 * contact-form message to the previous client's inbox — and the fix is the one
 * `seo/resolvePublicBaseUrl` already models: refuse to boot rather than
 * mis-deliver. Throws before the schema parse, so the message names every
 * missing key at once instead of one per restart.
 */
function assertMailIdentitySet(env: NodeJS.ProcessEnv): void {
  if (!isProduction(env)) return;
  const keys = [...MAIL_IDENTITY_KEYS, ...MAIL_PUBLIC_HOST_KEYS];
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length === 0) return;
  throw new Error(
    `Mail identity is unset in production: ${missing.join(', ')}. ` +
      'Set each one on the deployment; the development defaults must never ship.',
  );
}
