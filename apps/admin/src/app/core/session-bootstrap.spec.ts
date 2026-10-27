import { TestBed } from '@angular/core/testing';
import { AuthService } from '@admin-services';
import type { AdminSessionUser } from '@admin-types';
import { AuthStore } from './stores/auth.store';
import { BOOTSTRAP_LOCALE } from './tokens';
import { provideSessionBootstrap } from './session-bootstrap';
import * as sentry from './sentry';

jest.mock('./sentry', () => ({
  captureException: jest.fn(),
  initSentry: jest.fn(),
}));

/**
 * Constitution §3.15-C — the cold-start bootstrap resolves the session with a
 * single `getSession()` and commits it once, atomically, or not at all. There
 * is one resolved object — no access-token + `/me` pair — so half-hydration is
 * structurally impossible and there is never a `clearSession()` on a transient
 * failure.
 */
describe('provideSessionBootstrap', () => {
  let getSessionSpy: jest.Mock;
  const captureException = sentry.captureException as jest.Mock;

  const userFixture: AdminSessionUser = {
    id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
    email: 'owner@example.com',
    roles: [],
    permissions: ['orders:view'],
    status: 'active',
    role: 'ADMIN',
  };

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: AuthService, useValue: { getSession: getSessionSpy } },
        provideSessionBootstrap(),
      ],
    });
  }

  beforeEach(() => {
    captureException.mockClear();
  });

  it('commits the resolved user to the store in one atomic setSession', async () => {
    getSessionSpy = jest.fn(() => Promise.resolve(userFixture));
    configure();
    await TestBed.inject(AuthStore);
    await new Promise((r) => setTimeout(r, 0));
    const store = TestBed.inject(AuthStore);
    expect(getSessionSpy).toHaveBeenCalledTimes(1);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.user()).toEqual(userFixture);
  });

  it('leaves the store empty when getSession resolves null — logged out or transient', async () => {
    getSessionSpy = jest.fn(() => Promise.resolve(null));
    configure();
    await TestBed.inject(AuthStore);
    await new Promise((r) => setTimeout(r, 0));
    const store = TestBed.inject(AuthStore);
    expect(getSessionSpy).toHaveBeenCalledTimes(1);
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
  });

  it('never calls clear() — there is no partial state to roll back (§3.15-C)', async () => {
    const clearSpy = jest.spyOn(AuthStore.prototype, 'clear');
    try {
      getSessionSpy = jest.fn(() => Promise.resolve(null));
      configure();
      await TestBed.inject(AuthStore);
      await new Promise((r) => setTimeout(r, 0));
      expect(clearSpy).not.toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('boots the shell and reports to Sentry when getSession throws unexpectedly', async () => {
    const boom = new Error('boom');
    getSessionSpy = jest.fn(() => Promise.reject(boom));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      configure();
      await TestBed.inject(AuthStore);
      await new Promise((r) => setTimeout(r, 0));
      const store = TestBed.inject(AuthStore);
      expect(store.isAuthenticated()).toBe(false);
      expect(captureException).toHaveBeenCalledWith(boom);
      expect(warn).toHaveBeenCalledWith(
        '[session-bootstrap] unexpected failure resolving session',
        boom,
      );
    } finally {
      warn.mockRestore();
    }
  });
  /**
   * Finding AD6 / AD11. The auth cookie is shared across subdomains on
   * production by design, so a customer signed in on the storefront presents
   * it to the admin host. The bootstrap committed whatever parsed, so the full
   * admin shell rendered with their name on it; only the server-side 403s kept
   * the data safe.
   *
   * The gate is a refusal to commit, never a revoke: signing them out from
   * here would log them out of the STOREFRONT for clicking a wrong link.
   */
  it('refuses to commit a CUSTOMER session, leaving the shell unauthenticated', async () => {
    getSessionSpy = jest.fn(() => Promise.resolve({ ...userFixture, role: 'CUSTOMER' as const }));
    configure();
    await TestBed.inject(AuthStore);
    await new Promise((r) => setTimeout(r, 0));
    const store = TestBed.inject(AuthStore);
    expect(getSessionSpy).toHaveBeenCalledTimes(1);
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT'] as const)(
    'still commits a %s session unchanged',
    async (role) => {
      getSessionSpy = jest.fn(() => Promise.resolve({ ...userFixture, role }));
      configure();
      await TestBed.inject(AuthStore);
      await new Promise((r) => setTimeout(r, 0));
      const store = TestBed.inject(AuthStore);
      expect(store.isAuthenticated()).toBe(true);
      expect(store.user()?.role).toBe(role);
    },
  );

  it('does not revoke the shared session when it refuses a customer', async () => {
    const clearSpy = jest.spyOn(AuthStore.prototype, 'clear');
    try {
      getSessionSpy = jest.fn(() => Promise.resolve({ ...userFixture, role: 'CUSTOMER' as const }));
      configure();
      await TestBed.inject(AuthStore);
      await new Promise((r) => setTimeout(r, 0));
      expect(clearSpy).not.toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });
});
