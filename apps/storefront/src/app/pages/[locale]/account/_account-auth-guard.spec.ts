import { describe, expect, it, vi } from 'vitest';

import { AuthStateService } from '../../../services/auth-state.service';
import { LocaleService } from '../../../locale.service';
import { ensureAuthedForAccount } from './_account-auth-guard';

interface DeferredBoot {
  promise: Promise<void>;
  resolve: () => void;
}

function deferredBoot(): DeferredBoot {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeDeps(opts: {
  isAuthed: boolean | (() => boolean);
  locale?: 'fr' | 'en';
  boot?: DeferredBoot;
}) {
  const boot = opts.boot ?? { promise: Promise.resolve(), resolve: () => undefined };
  const read = typeof opts.isAuthed === 'function' ? opts.isAuthed : () => opts.isAuthed as boolean;
  const authState = {
    isAuthed: read,
    whenBooted: () => boot.promise,
  } as unknown as AuthStateService;
  const locale = {
    locale: () => opts.locale ?? 'fr',
  } as unknown as LocaleService;
  const router = { navigateByUrl: vi.fn() } as unknown as {
    navigateByUrl: ReturnType<typeof vi.fn>;
  };
  return {
    deps: { authState, locale, router: router as never },
    router,
    boot,
  };
}

describe('ensureAuthedForAccount', () => {
  it('returns true and does not navigate when the customer is authed', async () => {
    const { deps, router } = makeDeps({ isAuthed: true });
    const allowed = await ensureAuthedForAccount(deps, '/fr/account');
    expect(allowed).toBe(true);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('returns false and navigates to login with the from-param preserved when anonymous', async () => {
    const { deps, router } = makeDeps({ isAuthed: false });
    const allowed = await ensureAuthedForAccount(deps, '/fr/account/orders');
    expect(allowed).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    const [target] = router.navigateByUrl.mock.calls[0];
    expect(target).toBe('/fr/auth/login?from=%2Ffr%2Faccount%2Forders');
  });

  it('honours the active locale when constructing the login route', async () => {
    const { deps, router } = makeDeps({ isAuthed: false, locale: 'en' });
    await ensureAuthedForAccount(deps, '/en/account/profile');
    const [target] = router.navigateByUrl.mock.calls[0];
    expect(target).toBe('/en/auth/login?from=%2Fen%2Faccount%2Fprofile');
  });

  /**
   * Finding N4. The guard used to read `isAuthed()` the instant the page
   * mounted, while the shell's single `getSession()` was still in flight, so a
   * customer with a perfectly valid cookie was redirected to the login form.
   */
  it('does not redirect while the session boot is still pending', async () => {
    const boot = deferredBoot();
    const { deps, router } = makeDeps({ isAuthed: false, boot });
    let settled = false;
    const pending = ensureAuthedForAccount(deps, '/fr/account').then((v) => {
      settled = true;
      return v;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    boot.resolve();
    await pending;
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it('allows a customer whose session commits only after the guard was called', async () => {
    const boot = deferredBoot();
    let authed = false;
    const { deps, router } = makeDeps({ isAuthed: () => authed, boot });
    const pending = ensureAuthedForAccount(deps, '/fr/account/profile');

    authed = true;
    boot.resolve();

    await expect(pending).resolves.toBe(true);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
