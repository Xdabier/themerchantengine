import type { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import type { AuthService } from '@storefront-services';

import type { AuthStateService } from './auth-state.service';
import type { LocaleService } from '../locale.service';
import { signOutAndGoHome } from './sign-out';

function makeDeps(opts: { signOutThrows?: boolean; locale?: 'fr' | 'en' } = {}) {
  const order: string[] = [];
  const signOut = vi.fn(async () => {
    order.push('signOut');
    if (opts.signOutThrows) throw new Error('network down');
  });
  const clearSession = vi.fn(() => {
    order.push('clearSession');
  });
  const navigateByUrl = vi.fn(async (url: string) => {
    order.push(`navigate:${url}`);
    return true;
  });
  return {
    order,
    signOut,
    clearSession,
    navigateByUrl,
    deps: {
      authSvc: { signOut } as unknown as AuthService,
      authState: { clearSession } as unknown as AuthStateService,
      locale: { locale: () => opts.locale ?? 'fr' } as unknown as LocaleService,
      router: { navigateByUrl } as unknown as Router,
    },
  };
}

/**
 * Finding A2. Sign-out lived only inside the header account menu, so the
 * account pages could not offer it and a second caller would have had to
 * re-derive this ordering by hand.
 */
describe('signOutAndGoHome', () => {
  it('signs out, clears the local session, then lands on the locale home', async () => {
    const { deps, order } = makeDeps();
    await signOutAndGoHome(deps);
    expect(order).toEqual(['signOut', 'clearSession', 'navigate:/fr/']);
  });

  it('honours the active locale for the destination', async () => {
    const { deps, navigateByUrl } = makeDeps({ locale: 'en' });
    await signOutAndGoHome(deps);
    expect(navigateByUrl).toHaveBeenCalledWith('/en/');
  });

  it('still clears the session and navigates when the server call fails', async () => {
    const { deps, order, clearSession } = makeDeps({ signOutThrows: true });
    // A failed sign-out must never strand the customer in a shell that still
    // looks signed in.
    await expect(signOutAndGoHome(deps)).resolves.toBeUndefined();
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['signOut', 'clearSession', 'navigate:/fr/']);
  });

  it('clears the session before navigating, so the destination renders anonymous', async () => {
    const { deps, order } = makeDeps();
    await signOutAndGoHome(deps);
    expect(order.indexOf('clearSession')).toBeLessThan(
      order.findIndex((step) => step.startsWith('navigate:')),
    );
  });
});
