import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STOREFRONT_LOCALE } from '../shared/api-client.token';
import { AuthService } from './auth.service';
import type { StorefrontAuthClient } from './auth-client';

/**
 * Minimal fake of the Better Auth client surface `AuthService` consumes. Each
 * method defaults to a success envelope; a test overrides a specific `vi.fn`
 * via `.mockResolvedValueOnce` / `.mockRejectedValueOnce`.
 */
function fakeClient() {
  return {
    getSession: vi.fn(async () => ({ data: null as unknown, error: null as unknown })),
    signUp: { email: vi.fn(async () => ({ data: {} as unknown, error: null as unknown })) },
    signIn: {
      email: vi.fn(async () => ({ data: {} as unknown, error: null as unknown })),
      magicLink: vi.fn(async () => ({ data: {} as unknown, error: null as unknown })),
    },
    signOut: vi.fn(async () => ({ data: {} as unknown, error: null as unknown })),
    requestPasswordReset: vi.fn(async () => ({ data: {} as unknown, error: null as unknown })),
    resetPassword: vi.fn(async () => ({ data: {} as unknown, error: null as unknown })),
  };
}

function service(client: ReturnType<typeof fakeClient>): AuthService {
  return new AuthService(client as unknown as StorefrontAuthClient);
}

const SESSION_USER = {
  id: 'cus_01HX9TJ4ZK',
  email: 'fx-customer@auth.test',
  firstName: 'Aisha',
  lastName: 'Karim',
  locale: 'fr',
};

describe('AuthService.getSession', () => {
  it('resolves a CustomerUser when the client returns a session user', async () => {
    const client = fakeClient();
    client.getSession.mockResolvedValue({ data: { user: SESSION_USER }, error: null });
    const result = await service(client).getSession();
    expect(result).not.toBeNull();
    expect(result?.id).toBe('cus_01HX9TJ4ZK');
    expect(result?.firstName).toBe('Aisha');
  });

  it('maps the Better Auth `image` field onto `avatarUrl`', async () => {
    const client = fakeClient();
    client.getSession.mockResolvedValue({
      data: { user: { ...SESSION_USER, image: 'https://cdn.test/a.png' } },
      error: null,
    });
    const result = await service(client).getSession();
    expect(result?.avatarUrl).toBe('https://cdn.test/a.png');
  });

  it('returns null when the client reports an error', async () => {
    const client = fakeClient();
    client.getSession.mockResolvedValue({ data: null, error: { status: 500 } });
    expect(await service(client).getSession()).toBeNull();
  });

  it('returns null when there is no session data', async () => {
    const client = fakeClient();
    client.getSession.mockResolvedValue({ data: null, error: null });
    expect(await service(client).getSession()).toBeNull();
  });

  it('returns null when the session user fails schema validation', async () => {
    const client = fakeClient();
    client.getSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect(await service(client).getSession()).toBeNull();
  });
});

describe('AuthService.register', () => {
  it('signs up, deriving `name` and forwarding the names + callbackURL', async () => {
    const client = fakeClient();
    const result = await service(client).register(
      { email: 'a@b.co', password: 'Aa1aaaaa', firstName: 'Jane', lastName: 'Doe' },
      'https://shop.test/fr/',
    );
    expect(result).toEqual({ ok: true });
    expect(client.signUp.email).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.co',
        name: 'Jane Doe',
        firstName: 'Jane',
        lastName: 'Doe',
        callbackURL: 'https://shop.test/fr/',
      }),
    );
  });

  it('keeps Accept-Language on the sign-up call, alongside the bot headers', async () => {
    // The client sets Accept-Language once as a client-level default, but the
    // underlying fetch merges per-call options shallowly: a call that passes
    // its own fetchOptions.headers replaces that default wholesale. Sign-up is
    // the one call that does, for the honeypot and captcha headers, so
    // registration was asking the API for the browser's language rather than
    // the store's. The bot headers must survive too, or the guard fails closed
    // on every real signup.
    const client = fakeClient();
    await service(client).register(
      { email: 'a@b.co', password: 'Aa1aaaaa', firstName: 'Jane', lastName: 'Doe' },
      'https://shop.test/fr/',
      { captchaToken: 'tok', honeypot: '' },
    );
    const sent = client.signUp.email.mock.calls[0][0] as {
      fetchOptions: { headers: Record<string, string> };
    };
    expect(sent.fetchOptions.headers['Accept-Language']).toBe(DEFAULT_STOREFRONT_LOCALE);
    expect(sent.fetchOptions.headers['x-hp-field']).toBe('');
    expect(sent.fetchOptions.headers['x-captcha-response']).toBe('tok');
  });

  it('returns a failure when the client reports an error', async () => {
    const client = fakeClient();
    client.signUp.email.mockResolvedValue({
      data: null,
      error: { code: 'USER_ALREADY_EXISTS', status: 422, message: 'exists' },
    });
    const result = await service(client).register(
      { email: 'a@b.co', password: 'Aa1aaaaa', firstName: 'Jane', lastName: 'Doe' },
      'https://shop.test/fr/',
    );
    expect(result).toEqual({
      ok: false,
      failure: { code: 'USER_ALREADY_EXISTS', status: 422, message: 'exists' },
    });
  });

  it('throws when the caller input fails validation', async () => {
    const client = fakeClient();
    await expect(
      service(client).register(
        { email: 'not-email', password: 'short', firstName: '', lastName: '' } as never,
        'https://shop.test/fr/',
      ),
    ).rejects.toThrow();
    expect(client.signUp.email).not.toHaveBeenCalled();
  });

  it('returns a failure when the client throws', async () => {
    const client = fakeClient();
    client.signUp.email.mockRejectedValue(new Error('network down'));
    const result = await service(client).register(
      { email: 'a@b.co', password: 'Aa1aaaaa', firstName: 'Jane', lastName: 'Doe' },
      'https://shop.test/fr/',
    );
    expect(result.ok).toBe(false);
  });
});

describe('AuthService.login', () => {
  it('returns "authenticated" with the resolved customer on success', async () => {
    const client = fakeClient();
    client.getSession.mockResolvedValue({ data: { user: SESSION_USER }, error: null });
    const result = await service(client).login({ email: 'a@b.co', password: 'pw' });
    expect(result.status).toBe('authenticated');
    if (result.status === 'authenticated') {
      expect(result.user.id).toBe('cus_01HX9TJ4ZK');
    }
  });

  it('returns "failed" with the normalised failure on a client error', async () => {
    const client = fakeClient();
    client.signIn.email.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, message: 'bad creds' },
    });
    const result = await service(client).login({ email: 'a@b.co', password: 'pw' });
    expect(result).toEqual({
      status: 'failed',
      failure: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, message: 'bad creds' },
    });
  });

  it('returns "failed" when sign-in succeeds but the session does not resolve', async () => {
    const client = fakeClient();
    // signIn.email succeeds (the default), getSession resolves null (the default).
    const result = await service(client).login({ email: 'a@b.co', password: 'pw' });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.failure.code).toBe('SESSION_UNRESOLVED');
    }
  });

  it('throws when the caller input fails validation', async () => {
    const client = fakeClient();
    await expect(service(client).login({ email: 'a@b.co', password: '' })).rejects.toThrow();
    expect(client.signIn.email).not.toHaveBeenCalled();
  });
});

describe('AuthService.signOut', () => {
  it('calls the client sign-out', async () => {
    const client = fakeClient();
    await service(client).signOut();
    expect(client.signOut).toHaveBeenCalled();
  });

  it('resolves even when the client sign-out throws', async () => {
    const client = fakeClient();
    client.signOut.mockRejectedValue(new Error('boom'));
    await expect(service(client).signOut()).resolves.toBeUndefined();
  });
});

describe('AuthService.forgotPassword', () => {
  it('requests a reset, forwarding the email + redirectTo', async () => {
    const client = fakeClient();
    const result = await service(client).forgotPassword(
      { email: 'a@b.co' },
      'https://shop.test/fr/auth/reset-password',
    );
    expect(result).toEqual({ ok: true });
    expect(client.requestPasswordReset).toHaveBeenCalledWith({
      email: 'a@b.co',
      redirectTo: 'https://shop.test/fr/auth/reset-password',
    });
  });

  it('throws on an invalid email', async () => {
    const client = fakeClient();
    await expect(
      service(client).forgotPassword({ email: 'not-email' } as never, 'https://shop.test/'),
    ).rejects.toThrow();
  });
});

describe('AuthService.resetPassword', () => {
  it('consumes the token and sets the new password', async () => {
    const client = fakeClient();
    const result = await service(client).resetPassword({ token: 'tok', password: 'Aa1aaaaa' });
    expect(result).toEqual({ ok: true });
    expect(client.resetPassword).toHaveBeenCalledWith({
      newPassword: 'Aa1aaaaa',
      token: 'tok',
    });
  });

  it('throws on an empty token', async () => {
    const client = fakeClient();
    await expect(
      service(client).resetPassword({ token: '', password: 'Aa1aaaaa' } as never),
    ).rejects.toThrow();
  });
});

describe('AuthService.sendMagicLink', () => {
  it('emails a magic link, forwarding the email + callbackURL', async () => {
    const client = fakeClient();
    const result = await service(client).sendMagicLink(
      { email: 'a@b.co' },
      'https://shop.test/fr/',
    );
    expect(result).toEqual({ ok: true });
    expect(client.signIn.magicLink).toHaveBeenCalledWith({
      email: 'a@b.co',
      callbackURL: 'https://shop.test/fr/',
    });
  });

  it('throws on an invalid email', async () => {
    const client = fakeClient();
    await expect(
      service(client).sendMagicLink({ email: 'not-email' } as never, 'https://shop.test/'),
    ).rejects.toThrow();
  });
});
