import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { ADMIN_AUTH_CLIENT, type AdminAuthClient } from './auth-client';

/**
 * `AuthService` is a thin typed wrapper over the Better Auth client. The client
 * is mocked through the `ADMIN_AUTH_CLIENT` token — no real fetch stack — so
 * these specs pin the result-normalisation and Zod-parsing logic.
 */

interface FakeClient {
  signIn: { email: jest.Mock; magicLink: jest.Mock };
  signOut: jest.Mock;
  getSession: jest.Mock;
  requestPasswordReset: jest.Mock;
  resetPassword: jest.Mock;
  sendVerificationEmail: jest.Mock;
  twoFactor: { enable: jest.Mock; verifyTotp: jest.Mock; disable: jest.Mock };
}

function makeClient(): FakeClient {
  return {
    signIn: { email: jest.fn(), magicLink: jest.fn() },
    signOut: jest.fn(() => Promise.resolve({ data: null, error: null })),
    getSession: jest.fn(),
    requestPasswordReset: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    resetPassword: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    sendVerificationEmail: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    twoFactor: {
      enable: jest.fn(),
      verifyTotp: jest.fn(() => Promise.resolve({ data: {}, error: null })),
      disable: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    },
  };
}

const sessionUser = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
  email: 'admin@example.com',
  roles: [],
  permissions: ['orders:view'],
  status: 'active',
  // The Better Auth `customSession` plugin puts this on every session payload
  // (`apps/api/src/auth/auth.ts`); the admin schema used to strip it, which is
  // how a CUSTOMER session mounted the admin shell (finding AD6).
  role: 'ADMIN',
};

describe('AuthService', () => {
  let client: FakeClient;
  let service: AuthService;

  beforeEach(() => {
    client = makeClient();
    TestBed.configureTestingModule({
      providers: [{ provide: ADMIN_AUTH_CLIENT, useValue: client as unknown as AdminAuthClient }],
    });
    service = TestBed.inject(AuthService);
  });

  describe('getSession', () => {
    it('carries the account role through instead of stripping it', async () => {
      client.getSession.mockResolvedValue({
        data: { user: { ...sessionUser, role: 'CUSTOMER' }, session: {} },
        error: null,
      });
      const user = await service.getSession();
      expect(user?.role).toBe('CUSTOMER');
    });

    it('resolves null for a session payload with no role, rather than guessing', async () => {
      const { role, ...roleless } = sessionUser;
      void role;
      client.getSession.mockResolvedValue({
        data: { user: roleless, session: {} },
        error: null,
      });
      // Fail closed: a session we cannot classify is not a staff session.
      await expect(service.getSession()).resolves.toBeNull();
    });

    it('returns the parsed AdminUser when the client resolves a session', async () => {
      client.getSession.mockResolvedValue({
        data: { user: sessionUser, session: {} },
        error: null,
      });
      const user = await service.getSession();
      expect(user?.email).toBe('admin@example.com');
    });

    it('returns null when the client resolves an error', async () => {
      client.getSession.mockResolvedValue({ data: null, error: { status: 401 } });
      expect(await service.getSession()).toBeNull();
    });

    it('returns null when there is no session data', async () => {
      client.getSession.mockResolvedValue({ data: null, error: null });
      expect(await service.getSession()).toBeNull();
    });

    it('returns null when the session user fails schema validation', async () => {
      client.getSession.mockResolvedValue({
        data: { user: { id: 'not-an-id', email: 'bad' }, session: {} },
        error: null,
      });
      expect(await service.getSession()).toBeNull();
    });
  });

  describe('signIn', () => {
    it('returns authenticated on a clean sign-in', async () => {
      client.signIn.email.mockResolvedValue({
        data: { token: 't', user: sessionUser },
        error: null,
      });
      const r = await service.signIn({ email: 'a@b.co', password: 'pw' });
      expect(r.status).toBe('authenticated');
    });

    it('returns two-factor-required when the response asks for 2FA', async () => {
      client.signIn.email.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
      const r = await service.signIn({ email: 'a@b.co', password: 'pw' });
      expect(r.status).toBe('two-factor-required');
    });

    it('returns failed with a normalised failure on an error', async () => {
      client.signIn.email.mockResolvedValue({
        data: null,
        error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, message: 'no' },
      });
      const r = await service.signIn({ email: 'a@b.co', password: 'pw' });
      expect(r.status).toBe('failed');
      if (r.status === 'failed') {
        expect(r.failure.code).toBe('INVALID_EMAIL_OR_PASSWORD');
        expect(r.failure.status).toBe(401);
      }
    });
  });

  describe('one-shot action methods', () => {
    it('requestPasswordReset returns ok on success', async () => {
      const r = await service.requestPasswordReset({ email: 'a@b.co' });
      expect(r.ok).toBe(true);
      expect(client.requestPasswordReset).toHaveBeenCalled();
    });

    it('resetPassword returns the failure on an error', async () => {
      client.resetPassword.mockResolvedValue({
        data: null,
        error: { status: 400, message: 'bad' },
      });
      const r = await service.resetPassword({ token: 'tok', password: 'Abcdefg1' });
      expect(r.ok).toBe(false);
    });

    it('verifyTwoFactor verifies the TOTP code', async () => {
      const r = await service.verifyTwoFactor('123456');
      expect(r.ok).toBe(true);
      expect(client.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    });

    it('sendMagicLink returns ok on success', async () => {
      client.signIn.magicLink.mockResolvedValue({ data: {}, error: null });
      const r = await service.sendMagicLink({ email: 'a@b.co' });
      expect(r.ok).toBe(true);
    });

    it('normalises a thrown client error into a status-0 failure', async () => {
      client.resetPassword.mockRejectedValue(new Error('network down'));
      const r = await service.resetPassword({ token: 'tok', password: 'Abcdefg1' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.failure.status).toBe(0);
    });

    it('resendVerificationEmail returns ok on success', async () => {
      const r = await service.resendVerificationEmail('a@b.co');
      expect(r.ok).toBe(true);
      expect(client.sendVerificationEmail).toHaveBeenCalled();
    });

    it('resendVerificationEmail returns the failure on an error', async () => {
      client.sendVerificationEmail.mockResolvedValue({
        data: null,
        error: { status: 429, message: '' },
      });
      const r = await service.resendVerificationEmail('a@b.co');
      expect(r.ok).toBe(false);
      expect(client.sendVerificationEmail).toHaveBeenCalled();
    });
  });

  describe('two-factor enrolment', () => {
    it('enableTwoFactor returns the TOTP URI and backup codes', async () => {
      client.twoFactor.enable.mockResolvedValue({
        data: { totpURI: 'otpauth://totp/x?secret=ABC', backupCodes: ['c1', 'c2'] },
        error: null,
      });
      const r = await service.enableTwoFactor('pw');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.totpUri).toContain('otpauth://');
        expect(r.backupCodes).toEqual(['c1', 'c2']);
      }
    });

    it('enableTwoFactor returns a failure on a wrong password', async () => {
      client.twoFactor.enable.mockResolvedValue({
        data: null,
        error: { status: 401, message: 'bad password' },
      });
      const r = await service.enableTwoFactor('wrong');
      expect(r.ok).toBe(false);
    });

    it('confirmTwoFactor verifies the enrolment code', async () => {
      const r = await service.confirmTwoFactor('654321');
      expect(r.ok).toBe(true);
      expect(client.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: '654321' });
    });

    it('disableTwoFactor calls the client with the password', async () => {
      const r = await service.disableTwoFactor('pw');
      expect(r.ok).toBe(true);
      expect(client.twoFactor.disable).toHaveBeenCalledWith({ password: 'pw' });
    });
  });

  describe('signOut', () => {
    it('resolves even when the client rejects (best-effort)', async () => {
      client.signOut.mockRejectedValue(new Error('boom'));
      await expect(service.signOut()).resolves.toBeUndefined();
    });
  });
});
