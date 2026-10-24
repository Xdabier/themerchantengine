import type { ConfigService } from '@nestjs/config';

/**
 * The one place the store's mail identity is spelled out.
 *
 * Before D7 the same four values were hardcoded as ConfigService fallbacks in
 * six places, `mail.env.ts`, `mail.processor.ts` twice over, `campaign.service.ts`
 * twice over, and `contact.service.ts`, so missing one meant a silent
 * misdelivery rather than a visible error. `plan.md` §7 records the cluster;
 * this module is the collapse of it.
 *
 * The defaults are development conveniences only. `validateMailEnv` refuses to
 * boot in production when any of them is left unset, so a deployment always
 * sends from an address someone chose for that deployment.
 */
export const MAIL_IDENTITY_DEFAULTS = {
  fromEmail: 'noreply@example.test',
  /** The stepper writes the store name here at install (plan E4.3). */
  fromName: 'My Store',
  replyTo: 'contact@example.test',
  contactRecipient: 'contact@example.test',
} as const;

/** The env keys that carry the identity, in the order the boot guard reports them. */
export const MAIL_IDENTITY_KEYS = [
  'RESEND_FROM_EMAIL',
  'RESEND_FROM_NAME',
  'RESEND_REPLY_TO',
  'CONTACT_FORM_RECIPIENT',
] as const;

export interface MailIdentity {
  fromEmail: string;
  fromName: string;
  replyTo: string;
  contactRecipient: string;
  /** `Name <address>`, the composed `From:` header Resend takes. */
  from: string;
}

/**
 * Quote a `From:` display name when RFC 5322 requires it.
 *
 * A bare `display-name` is a `phrase`, and `.` is not `atext`, so a dotted
 * store name before `<noreply@example.test>` parses only under the obsolete grammar. Every previous
 * client name was dot-free, so this arrives with this client, on the one header
 * every outbound message carries.
 */
const RFC5322_SPECIALS = /[()<>@,;:\\".[\]]/;

function quoteDisplayName(name: string): string {
  if (!RFC5322_SPECIALS.test(name)) return name;
  return `"${name.replace(/(["\\])/g, '\\$1')}"`;
}

/** Resolve the identity from config, falling back to the development defaults. */
export function resolveMailIdentity(config: ConfigService): MailIdentity {
  const fromEmail = config.get<string>('RESEND_FROM_EMAIL', MAIL_IDENTITY_DEFAULTS.fromEmail);
  const fromName = config.get<string>('RESEND_FROM_NAME', MAIL_IDENTITY_DEFAULTS.fromName);
  return {
    fromEmail,
    fromName,
    replyTo: config.get<string>('RESEND_REPLY_TO', MAIL_IDENTITY_DEFAULTS.replyTo),
    contactRecipient: config.get<string>(
      'CONTACT_FORM_RECIPIENT',
      MAIL_IDENTITY_DEFAULTS.contactRecipient,
    ),
    from: `${quoteDisplayName(fromName)} <${fromEmail}>`,
  };
}
