import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../modules/mail/mail.service';
import { AuthMailerProvider } from './auth-mailer.provider';

/** The origins the shared host helper falls back to when nothing is configured. */
const STOREFRONT_DEFAULT = 'https://storefront.example.test';

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('AuthMailerProvider', () => {
  let provider: AuthMailerProvider;
  let mail: { enqueue: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };
  let savedStorefrontUrl: string | undefined;

  beforeEach(() => {
    // The host helper reads process.env directly, so an ambient value from the
    // shell would decide these assertions instead of the code under test.
    savedStorefrontUrl = process.env.STOREFRONT_PUBLIC_BASE_URL;
    delete process.env.STOREFRONT_PUBLIC_BASE_URL;
    mail = { enqueue: jest.fn().mockResolvedValue({ logId: 'l1' }) };
    prisma = { user: { findUnique: jest.fn().mockResolvedValue({ locale: 'en' }) } };
    provider = new AuthMailerProvider(
      mail as unknown as MailService,
      prisma as unknown as PrismaService,
    );
  });

  afterEach(() => {
    if (savedStorefrontUrl !== undefined) {
      process.env.STOREFRONT_PUBLIC_BASE_URL = savedStorefrontUrl;
    }
  });

  it('sendWelcome enqueues customer.welcome with the storefront URL + firstName', async () => {
    await provider.sendWelcome('new@example.com', 'Sam');

    expect(mail.enqueue).toHaveBeenCalledWith(
      'customer.welcome',
      expect.objectContaining({
        to: 'new@example.com',
        locale: 'en',
        variables: expect.objectContaining({
          firstName: 'Sam',
          storefrontUrl: STOREFRONT_DEFAULT,
        }),
      }),
    );
  });

  // Polarity flip (D7.10): the inlined coercion this provider carried fell back
  // to en. A stranger, or a row whose locale has no template copy, is now
  // written to in French.
  it('writes to an unknown recipient in fr', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await provider.sendMagicLink('stranger@example.com', 'https://storefront.example.test/magic');

    expect(mail.enqueue).toHaveBeenCalledWith(
      'auth.magic-link',
      expect.objectContaining({ to: 'stranger@example.com', locale: 'fr' }),
    );
  });

  it('falls back to fr for a stored locale with no template copy', async () => {
    prisma.user.findUnique.mockResolvedValue({ locale: 'ar' });

    await provider.sendPasswordReset('legacy@example.com', 'https://storefront.example.test/reset');

    expect(mail.enqueue).toHaveBeenCalledWith(
      'auth.password-reset',
      expect.objectContaining({ to: 'legacy@example.com', locale: 'fr' }),
    );
  });

  it('keeps a BCP-47 regional tag on its base locale', async () => {
    prisma.user.findUnique.mockResolvedValue({ locale: 'fr-TN' });

    await provider.sendVerificationEmail(
      'marie@example.com',
      'https://storefront.example.test/verify',
    );

    expect(mail.enqueue).toHaveBeenCalledWith(
      'auth.email-verification',
      expect.objectContaining({ locale: 'fr' }),
    );
  });

  it('sendWelcome omits firstName when not supplied', async () => {
    await provider.sendWelcome('new@example.com');

    const call = mail.enqueue.mock.calls.find((c) => c[0] === 'customer.welcome');
    expect(call[1].variables).not.toHaveProperty('firstName');
  });

  it('sendEmailChangeAlert enqueues auth.email-change-alert to the OLD address with newEmail', async () => {
    prisma.user.findUnique.mockResolvedValue({ locale: 'fr' });

    await provider.sendEmailChangeAlert('old@example.com', 'new@example.com');

    expect(mail.enqueue).toHaveBeenCalledWith(
      'auth.email-change-alert',
      expect.objectContaining({
        to: 'old@example.com',
        locale: 'fr',
        variables: { newEmail: 'new@example.com' },
      }),
    );
  });

  it('swallows an enqueue failure so the auth flow is never blocked', async () => {
    mail.enqueue.mockRejectedValueOnce(new Error('redis down'));

    await expect(provider.sendWelcome('new@example.com')).resolves.toBeUndefined();
  });

  // ── 2FA email-OTP channel + enable/disable confirmations (NE8) ───────────────

  describe('two-factor (NE8)', () => {
    it('sendTwoFactorOtp enqueues auth.2fa-otp with the OTP code as a render variable', async () => {
      await provider.sendTwoFactorOtp('u@example.com', '123456');

      expect(mail.enqueue).toHaveBeenCalledWith(
        'auth.2fa-otp',
        expect.objectContaining({
          to: 'u@example.com',
          locale: 'en',
          variables: { otp: '123456' },
        }),
      );
    });

    it('does NOT pass the OTP as an actionUrl (no metadata leak vector)', async () => {
      await provider.sendTwoFactorOtp('u@example.com', '999000');
      const call = mail.enqueue.mock.calls.find((c) => c[0] === 'auth.2fa-otp');
      expect(call[1]).not.toHaveProperty('actionUrl');
    });

    it('sendTwoFactorEnabled enqueues auth.2fa-enabled with a securityUrl CTA', async () => {
      prisma.user.findUnique.mockResolvedValue({ locale: 'fr' });
      await provider.sendTwoFactorEnabled('u@example.com');

      expect(mail.enqueue).toHaveBeenCalledWith(
        'auth.2fa-enabled',
        expect.objectContaining({
          to: 'u@example.com',
          locale: 'fr',
          variables: { securityUrl: `${STOREFRONT_DEFAULT}/account` },
        }),
      );
    });

    it('sendTwoFactorDisabled enqueues auth.2fa-disabled with a securityUrl CTA', async () => {
      await provider.sendTwoFactorDisabled('u@example.com');

      expect(mail.enqueue).toHaveBeenCalledWith(
        'auth.2fa-disabled',
        expect.objectContaining({
          to: 'u@example.com',
          variables: { securityUrl: `${STOREFRONT_DEFAULT}/account` },
        }),
      );
    });

    it('swallows an enqueue failure on the OTP send (never blocks sign-in)', async () => {
      mail.enqueue.mockRejectedValueOnce(new Error('redis down'));
      await expect(provider.sendTwoFactorOtp('u@example.com', '111222')).resolves.toBeUndefined();
    });
  });
});
