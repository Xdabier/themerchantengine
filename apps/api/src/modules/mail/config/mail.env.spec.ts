import { validateMailEnv } from './mail.env';
import { MAIL_PUBLIC_HOST_KEYS } from './public-hosts';
import { MAIL_IDENTITY_DEFAULTS, MAIL_IDENTITY_KEYS } from './mail-identity';

// Every case below that is not about the production guard runs under `test`:
// an env with no label reads as production now (plan E4, the shared predicate).
const RESEND_OK = {
  NODE_ENV: 'test',
  MAIL_TRANSPORT: 'resend',
  RESEND_API_KEY: 're_0123456789abcdefghij', // gitleaks:allow
  RESEND_WEBHOOK_SECRET: 'whsec_0123456789', // gitleaks:allow
};

/**
 * The identity a real deployment must set for itself. Used to build the
 * production-boot cases below, so adding a fifth key to `MAIL_IDENTITY_KEYS`
 * makes the guard's coverage grow with it rather than silently lag.
 */
const IDENTITY_SET: NodeJS.ProcessEnv = {
  RESEND_FROM_EMAIL: 'noreply@example.test',
  RESEND_FROM_NAME: 'My Store',
  RESEND_REPLY_TO: 'contact@example.test',
  CONTACT_FORM_RECIPIENT: 'contact@example.test',
};

/**
 * The public origins are guarded alongside the identity, because an unset one
 * fails the same way: not loudly, but by sending a customer to whatever domain
 * the code defaulted to, inside an email that authenticates as this store.
 */
const HOSTS_SET: NodeJS.ProcessEnv = {
  STOREFRONT_PUBLIC_BASE_URL: 'https://storefront.example.test',
  ADMIN_PUBLIC_BASE_URL: 'https://admin.example.test',
  API_PUBLIC_BASE_URL: 'https://api.example.test',
};

describe('validateMailEnv', () => {
  it('accepts a valid resend config with no dev redirect', () => {
    expect(() => validateMailEnv({ ...RESEND_OK } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('defaults to the console transport when unset', () => {
    const env = validateMailEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(env.MAIL_TRANSPORT).toBe('console');
  });

  describe('resend required keys', () => {
    it('throws when RESEND_API_KEY is missing under resend', () => {
      expect(() =>
        validateMailEnv({
          NODE_ENV: 'test',
          MAIL_TRANSPORT: 'resend',
          RESEND_WEBHOOK_SECRET: 'whsec_0123456789', // gitleaks:allow
        } as NodeJS.ProcessEnv),
      ).toThrow(/RESEND_API_KEY/);
    });

    it('throws when RESEND_WEBHOOK_SECRET is missing under resend', () => {
      expect(() =>
        validateMailEnv({
          NODE_ENV: 'test',
          MAIL_TRANSPORT: 'resend',
          RESEND_API_KEY: 're_0123456789abcdefghij', // gitleaks:allow
        } as NodeJS.ProcessEnv),
      ).toThrow(/RESEND_WEBHOOK_SECRET/);
    });
  });

  describe('NE7 MAIL_DEV_REDIRECT_TO boot guard (Risk R11)', () => {
    it('throws when a redirect is set under MAIL_TRANSPORT=resend', () => {
      expect(() =>
        validateMailEnv({
          ...RESEND_OK,
          MAIL_DEV_REDIRECT_TO: 'qa@example.com',
        } as NodeJS.ProcessEnv),
      ).toThrow(/MAIL_DEV_REDIRECT_TO/);
    });

    it('treats an empty-string redirect as unset (no throw)', () => {
      expect(() =>
        validateMailEnv({ ...RESEND_OK, MAIL_DEV_REDIRECT_TO: '' } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it('allows a redirect under the console transport (dev only)', () => {
      expect(() =>
        validateMailEnv({
          NODE_ENV: 'test',
          MAIL_TRANSPORT: 'console',
          MAIL_DEV_REDIRECT_TO: 'qa@example.com',
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });

  /**
   * D7 boot guard. `validateMailEnv` reads NODE_ENV off the env object it is
   * handed, so every case here passes it explicitly, nothing touches
   * `process.env`, and no sibling spec inherits a production flag.
   */
  describe('D7 mail-identity boot guard', () => {
    it('throws in production when no identity key is set, naming every missing key', () => {
      let thrown: Error | undefined;
      try {
        validateMailEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).toBeDefined();
      for (const key of MAIL_IDENTITY_KEYS) {
        expect(thrown?.message).toContain(key);
      }
    });

    it('names only the keys actually missing', () => {
      const partial = {
        NODE_ENV: 'production',
        RESEND_FROM_EMAIL: 'noreply@example.test',
        RESEND_FROM_NAME: 'My Store',
      } as NodeJS.ProcessEnv;

      let message = '';
      try {
        validateMailEnv(partial);
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toContain('RESEND_REPLY_TO, CONTACT_FORM_RECIPIENT');
      expect(message).not.toContain('RESEND_FROM_EMAIL');
      expect(message).not.toContain('RESEND_FROM_NAME');
    });

    it('treats a whitespace-only value as unset', () => {
      expect(() =>
        validateMailEnv({
          ...IDENTITY_SET,
          NODE_ENV: 'production',
          CONTACT_FORM_RECIPIENT: '   ',
        } as NodeJS.ProcessEnv),
      ).toThrow(/CONTACT_FORM_RECIPIENT/);
    });

    it('boots in production once every identity and origin key is set explicitly', () => {
      const env = validateMailEnv({
        ...IDENTITY_SET,
        ...HOSTS_SET,
        ...RESEND_OK,
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv);

      expect(env.RESEND_FROM_EMAIL).toBe('noreply@example.test');
      expect(env.CONTACT_FORM_RECIPIENT).toBe('contact@example.test');
    });

    it('refuses to boot in production when a public origin is unset', () => {
      expect(() =>
        validateMailEnv({
          ...IDENTITY_SET,
          ...RESEND_OK,
          STOREFRONT_PUBLIC_BASE_URL: 'https://storefront.example.test',
          ADMIN_PUBLIC_BASE_URL: 'https://admin.example.test',
          NODE_ENV: 'production',
        } as NodeJS.ProcessEnv),
      ).toThrow(/API_PUBLIC_BASE_URL/);
    });

    it('names every unset origin at once rather than one per restart', () => {
      try {
        validateMailEnv({
          ...IDENTITY_SET,
          ...RESEND_OK,
          NODE_ENV: 'production',
        } as NodeJS.ProcessEnv);
        throw new Error('expected the guard to throw');
      } catch (err) {
        const message = (err as Error).message;
        for (const key of MAIL_PUBLIC_HOST_KEYS) {
          expect(message).toContain(key);
        }
      }
    });

    it('applies the development defaults outside production, and boots', () => {
      const env = validateMailEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);

      expect(env.RESEND_FROM_EMAIL).toBe(MAIL_IDENTITY_DEFAULTS.fromEmail);
      expect(env.RESEND_FROM_NAME).toBe(MAIL_IDENTITY_DEFAULTS.fromName);
      expect(env.RESEND_REPLY_TO).toBe(MAIL_IDENTITY_DEFAULTS.replyTo);
      expect(env.CONTACT_FORM_RECIPIENT).toBe(MAIL_IDENTITY_DEFAULTS.contactRecipient);
    });

    it('defaults to the example.test identity, never the previous client inbox', () => {
      const env = validateMailEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

      expect(env.RESEND_FROM_EMAIL).toBe('noreply@example.test');
      expect(env.RESEND_FROM_NAME).toBe('My Store');
      expect(env.RESEND_REPLY_TO).toBe('contact@example.test');
      // D1 found this one routing a customer's contact-form message to the
      // previous client's inbox.
      expect(env.CONTACT_FORM_RECIPIENT).toBe('contact@example.test');
    });
  });

  it.each([['staging'], ['prod'], [undefined]])(
    'throws under NODE_ENV=%s, because every label outside test and development is production',
    (label) => {
      expect(() => validateMailEnv({ NODE_ENV: label } as NodeJS.ProcessEnv)).toThrow(
        /Mail identity is unset in production/,
      );
    },
  );
});
