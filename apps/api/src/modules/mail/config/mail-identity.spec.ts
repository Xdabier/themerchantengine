/**
 * The store's mail identity (D7). `mail.env.spec.ts` covers the boot guard that
 * refuses production without these four keys; this file covers what the resolver
 * itself hands to the transport: the `Name <address>` composition, and a
 * configured value winning over the development default, key by key.
 *
 * The composition is the part a wrong default hides — an unset RESEND_FROM_NAME
 * still yields a valid header, so only an assertion on the composed string
 * catches an identity that quietly reverted to another client's.
 */
import type { ConfigService } from '@nestjs/config';
import { MAIL_IDENTITY_DEFAULTS, MAIL_IDENTITY_KEYS, resolveMailIdentity } from './mail-identity';

/** Mirrors the real `ConfigService.get(key, default)` contract. */
function fakeConfig(values: Record<string, string | undefined> = {}): ConfigService {
  return {
    get: (key: string, def?: string) => values[key] ?? def,
  } as unknown as ConfigService;
}

describe('resolveMailIdentity', () => {
  describe('defaults', () => {
    it('falls back to the example.test development identity when nothing is configured', () => {
      expect(resolveMailIdentity(fakeConfig())).toEqual({
        fromEmail: 'noreply@example.test',
        fromName: 'My Store',
        replyTo: 'contact@example.test',
        contactRecipient: 'contact@example.test',
        from: 'My Store <noreply@example.test>',
      });
    });

    it('reads its defaults from MAIL_IDENTITY_DEFAULTS, so the two never drift', () => {
      const identity = resolveMailIdentity(fakeConfig());
      expect(identity.fromEmail).toBe(MAIL_IDENTITY_DEFAULTS.fromEmail);
      expect(identity.fromName).toBe(MAIL_IDENTITY_DEFAULTS.fromName);
      expect(identity.replyTo).toBe(MAIL_IDENTITY_DEFAULTS.replyTo);
      expect(identity.contactRecipient).toBe(MAIL_IDENTITY_DEFAULTS.contactRecipient);
    });

    // The neutral name reaches the customer in the From: header of every send
    // until the install stepper writes the store name (plan E4.3).
    it('keeps the neutral display name until the installer writes the store name', () => {
      expect(resolveMailIdentity(fakeConfig()).fromName).toBe('My Store');
    });
  });

  describe('From: composition', () => {
    it('composes `Name <address>` from the configured pair', () => {
      const identity = resolveMailIdentity(
        fakeConfig({
          RESEND_FROM_NAME: 'Cabinet Example',
          RESEND_FROM_EMAIL: 'bonjour@example.test',
        }),
      );
      expect(identity.from).toBe('Cabinet Example <bonjour@example.test>');
    });

    it('composes from the configured address and the default name', () => {
      const identity = resolveMailIdentity(fakeConfig({ RESEND_FROM_EMAIL: 'ops@example.test' }));
      expect(identity.from).toBe('My Store <ops@example.test>');
    });

    it('composes from the configured name and the default address', () => {
      const identity = resolveMailIdentity(
        fakeConfig({ RESEND_FROM_NAME: 'example.test Support' }),
      );
      expect(identity.from).toBe('"example.test Support" <noreply@example.test>');
    });

    // The reply-to is a separate field, never folded into the From: header —
    // Resend takes it as its own parameter.
    it('never folds the reply-to into the From: header', () => {
      const identity = resolveMailIdentity(fakeConfig({ RESEND_REPLY_TO: 'sav@example.test' }));
      expect(identity.from).toBe('My Store <noreply@example.test>');
      expect(identity.replyTo).toBe('sav@example.test');
    });
  });

  describe('override precedence', () => {
    it('RESEND_FROM_EMAIL overrides the default sender address', () => {
      expect(
        resolveMailIdentity(fakeConfig({ RESEND_FROM_EMAIL: 'x@example.test' })).fromEmail,
      ).toBe('x@example.test');
    });

    it('RESEND_FROM_NAME overrides the default display name', () => {
      expect(resolveMailIdentity(fakeConfig({ RESEND_FROM_NAME: 'Example Shop' })).fromName).toBe(
        'Example Shop',
      );
    });

    it('RESEND_REPLY_TO overrides the default reply-to', () => {
      expect(
        resolveMailIdentity(fakeConfig({ RESEND_REPLY_TO: 'reply@example.test' })).replyTo,
      ).toBe('reply@example.test');
    });

    it('CONTACT_FORM_RECIPIENT overrides the default contact inbox', () => {
      expect(
        resolveMailIdentity(fakeConfig({ CONTACT_FORM_RECIPIENT: 'inbox@example.test' }))
          .contactRecipient,
      ).toBe('inbox@example.test');
    });

    it('overrides each of the four values independently, all at once', () => {
      expect(
        resolveMailIdentity(
          fakeConfig({
            RESEND_FROM_EMAIL: 'a@example.test',
            RESEND_FROM_NAME: 'A',
            RESEND_REPLY_TO: 'b@example.test',
            CONTACT_FORM_RECIPIENT: 'c@example.test',
          }),
        ),
      ).toEqual({
        fromEmail: 'a@example.test',
        fromName: 'A',
        replyTo: 'b@example.test',
        contactRecipient: 'c@example.test',
        from: 'A <a@example.test>',
      });
    });

    /**
     * A store name can carry a dot, and an RFC 5322 `display-name` is a
     * `phrase` whose `atext` excludes `.`, so an unquoted `Atlas.Supplies <...>`
     * parses only under the obsolete grammar. The resolver quotes such a name
     * on the one header every outbound message carries.
     */
    it('quotes a display name that carries a dot', () => {
      expect(resolveMailIdentity(fakeConfig({ RESEND_FROM_NAME: 'Atlas.Supplies' })).from).toBe(
        '"Atlas.Supplies" <noreply@example.test>',
      );
    });

    it('leaves a plain display name unquoted, because quoting it would be noise', () => {
      expect(resolveMailIdentity(fakeConfig({ RESEND_FROM_NAME: 'Acme Dental' })).from).toBe(
        'Acme Dental <noreply@example.test>',
      );
    });

    it('escapes a quote inside a display name rather than closing the quoted string', () => {
      const name = ['Say', String.fromCharCode(34), 'ah', String.fromCharCode(34)].join(' ');
      const from = resolveMailIdentity(fakeConfig({ RESEND_FROM_NAME: name })).from;
      expect(from.startsWith(String.fromCharCode(34))).toBe(true);
      expect(from).toContain(String.fromCharCode(92, 34));
      expect(from.endsWith('<noreply@example.test>')).toBe(true);
    });

    // Every key the boot guard reports must actually be honoured by the
    // resolver, so adding a fifth key to MAIL_IDENTITY_KEYS without wiring it
    // here fails rather than silently ignoring the operator's value.
    it('honours every key MAIL_IDENTITY_KEYS names', () => {
      const overridden = Object.fromEntries(
        MAIL_IDENTITY_KEYS.map((k) => [k, `${k}@example.test`]),
      );
      const identity = resolveMailIdentity(fakeConfig(overridden));
      const values = [
        identity.fromEmail,
        identity.fromName,
        identity.replyTo,
        identity.contactRecipient,
      ];
      for (const key of MAIL_IDENTITY_KEYS) {
        expect(values).toContain(`${key}@example.test`);
      }
    });
  });

  // The resolver reads ConfigService and nothing else — reading process.env
  // directly would bypass the validated env object the boot guard produced.
  it('does not reach around ConfigService into process.env', () => {
    const saved = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_FROM_EMAIL = 'leaked@elsewhere.test';
    try {
      expect(resolveMailIdentity(fakeConfig()).fromEmail).toBe('noreply@example.test');
    } finally {
      if (saved === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = saved;
    }
  });
});
