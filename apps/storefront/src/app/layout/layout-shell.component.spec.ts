import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PLATFORM_ID, provideZoneChangeDetection, signal } from '@angular/core';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LayoutShellComponent } from './layout-shell.component';
import { LocaleService } from '../locale.service';
import {
  AuthService,
  CartService,
  STOREFRONT_API_CLIENT,
  type ApiClient,
} from '@storefront-services';
import type { CustomerUser } from '@storefront-types';
import { AuthStateService } from '../services/auth-state.service';
import { getChromeStrings } from '../../i18n';
import type { Locale } from '../../i18n/types';

const SAMPLE_USER: CustomerUser = {
  id: 'cus_01HX9TJ4ZK',
  email: 'fx-customer@auth.test',
  firstName: 'Aisha',
  lastName: 'Karim',
  phone: null,
  avatarUrl: null,
  locale: 'fr',
  addresses: [],
};

class FakeLocaleService {
  readonly _locale = signal<Locale>('fr');
  readonly _url = signal('/fr/');
  readonly locale = this._locale.asReadonly();
  readonly currentUrl = this._url.asReadonly();
  readonly strings = signal(getChromeStrings('fr'));
  set(locale: Locale, url: string) {
    this._locale.set(locale);
    this._url.set(url);
    this.strings.set(getChromeStrings(locale));
  }
}

const noopApi: ApiClient = {
  get: async () => ({}) as never,
  post: async () => ({}) as never,
  patch: async () => ({}) as never,
  delete: async () => ({}) as never,
  request: async () => ({}) as never,
};

interface SetupOptions {
  locale?: Locale;
  url?: string;
  platform?: 'browser' | 'server';
  /** `AuthService.getSession` implementation for this test. Default: anonymous. */
  getSession?: () => Promise<CustomerUser | null>;
  /** `CartService.merge` implementation for this test. Default: resolves. */
  merge?: () => Promise<never>;
}

function setup(options: SetupOptions = {}) {
  const fakeLocale = new FakeLocaleService();
  fakeLocale.set(options.locale ?? 'fr', options.url ?? '/fr/');
  const getSession = vi.fn(options.getSession ?? (async () => null));
  const fakeAuth = { getSession } as unknown as AuthService;

  TestBed.configureTestingModule({
    imports: [LayoutShellComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([]),
      { provide: LocaleService, useValue: fakeLocale },
      { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
      { provide: AuthService, useValue: fakeAuth },
      { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
    ],
  });

  const cart = TestBed.inject(CartService);
  const cartSpy = vi.spyOn(cart, 'get').mockResolvedValue({} as never);
  const mergeSpy = vi
    .spyOn(cart, 'merge')
    .mockImplementation(options.merge ?? (async () => ({}) as never));
  const authState = TestBed.inject(AuthStateService);
  const setSessionSpy = vi.spyOn(authState, 'setSession');
  const clearSessionSpy = vi.spyOn(authState, 'clearSession');
  const fixture = TestBed.createComponent(LayoutShellComponent);
  fixture.detectChanges();
  return {
    fixture,
    fakeLocale,
    getSession,
    cartSpy,
    mergeSpy,
    authState,
    setSessionSpy,
    clearSessionSpy,
  };
}

/**
 * Flush the detached `void this.boot()` promise chain. `whenStable()` waits on
 * the zone task pump; `boot()`'s continuations after each `await` are plain
 * microtasks, so one macrotask hop plus a microtask drain settles it.
 */
async function flushBoot(fixture: { whenStable: () => Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('LayoutShellComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders header + footer + mobile-bottom-nav landmarks', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.querySelector('app-header')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-footer')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-mobile-bottom-nav')).toBeTruthy();
  });

  it('renders main element with the locale-keyed skip-link id', () => {
    const { fixture, fakeLocale } = setup({ locale: 'fr', url: '/fr/' });
    let main = fixture.nativeElement.querySelector('main') as HTMLElement;
    expect(main.getAttribute('id')).toBe('main-fr');
    fakeLocale.set('en', '/en/');
    fixture.detectChanges();
    main = fixture.nativeElement.querySelector('main') as HTMLElement;
    expect(main.getAttribute('id')).toBe('main-en');
  });

  // The container was mounted with no `dismissLabel`, so its close button fell
  // back to the component default, an English "Dismiss" served to /fr readers.
  it('gives the toast container a dismiss label in the active locale', () => {
    const { fixture, fakeLocale } = setup({ locale: 'fr', url: '/fr/' });
    const container = fixture.nativeElement.querySelector('app-toast-container') as HTMLElement;
    expect(container).toBeTruthy();

    const frLabel = getChromeStrings('fr').generic.dismissToast;
    expect(fixture.componentInstance.dismissToastLabel()).toBe(frLabel);

    fakeLocale.set('en', '/en/');
    fixture.detectChanges();
    expect(fixture.componentInstance.dismissToastLabel()).toBe(
      getChromeStrings('en').generic.dismissToast,
    );
    expect(getChromeStrings('en').generic.dismissToast).not.toBe(frLabel);
  });

  it('main element is focusable for skip-link activation', () => {
    const { fixture } = setup();
    const main = fixture.nativeElement.querySelector('main') as HTMLElement;
    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('triggers a cart hydration on init in the browser platform', async () => {
    const { fixture, cartSpy } = setup({ platform: 'browser' });
    await flushBoot(fixture);
    expect(cartSpy).toHaveBeenCalled();
  });

  it('does not trigger cart hydration during SSR (PLATFORM_ID=server)', async () => {
    const { fixture, cartSpy, getSession } = setup({ platform: 'server' });
    await flushBoot(fixture);
    expect(cartSpy).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  describe('boot resilience (constitution §3.11.6 / §3.15-C)', () => {
    /**
     * (a) An authed boot: a single `getSession()` resolves a customer → the
     * shell commits it with one atomic `setSession({ user })`.
     */
    it('commits the session with one setSession when getSession resolves a customer', async () => {
      const { fixture, getSession, setSessionSpy, authState } = setup({
        getSession: async () => SAMPLE_USER,
      });
      await flushBoot(fixture);

      expect(getSession).toHaveBeenCalledTimes(1);
      expect(setSessionSpy).toHaveBeenCalledTimes(1);
      expect(setSessionSpy).toHaveBeenCalledWith({ user: SAMPLE_USER });
      expect(authState.isAuthed()).toBe(true);
      expect(authState.currentUser()).toEqual(SAMPLE_USER);
    });

    /**
     * (c) An unauthenticated result yields the logged-out state without an
     * error — `getSession()` resolves `null`, the shell commits nothing.
     */
    it('leaves the shell logged-out and uncommitted when getSession resolves null', async () => {
      const { fixture, setSessionSpy, clearSessionSpy, authState } = setup({
        getSession: async () => null,
      });
      await flushBoot(fixture);

      expect(setSessionSpy).not.toHaveBeenCalled();
      expect(clearSessionSpy).not.toHaveBeenCalled();
      expect(authState.isAuthed()).toBe(false);
      expect(authState.currentUser()).toBeNull();
    });

    /**
     * (b) A transient failure leaves session state unchanged. `getSession()`
     * collapses 429 / 5xx / network to `null`; an unexpected client throw is
     * caught, logged, and the boot still completes without touching the store.
     */
    it('leaves session state unchanged and still boots when getSession throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { fixture, setSessionSpy, clearSessionSpy, authState, cartSpy } = setup({
        getSession: async () => {
          throw new Error('unexpected better-auth client fault');
        },
      });
      await flushBoot(fixture);

      expect(setSessionSpy).not.toHaveBeenCalled();
      expect(clearSessionSpy).not.toHaveBeenCalled();
      expect(authState.isAuthed()).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      // The shell still finishes booting — cart hydration runs regardless.
      expect(cartSpy).toHaveBeenCalled();
    });

    /**
     * Finding N4. Every account guard and the checkout bootstrap await the boot
     * OUTCOME, so all three outcomes must release those waiters: an authed
     * boot, a null one, and an unexpected client fault. A boot that never
     * settles is a page that never renders.
     */
    it.each([
      ['an authed session', async () => SAMPLE_USER],
      ['a null session', async () => null],
      [
        'an unexpected client fault',
        async () => {
          throw new Error('unexpected better-auth client fault');
        },
      ],
    ])('settles the boot outcome after %s', async (_label, getSession) => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { fixture, authState } = setup({
        getSession: getSession as () => Promise<CustomerUser | null>,
      });
      expect(authState.bootState()).toBe('pending');

      await flushBoot(fixture);

      expect(authState.bootState()).toBe('booted');
      await expect(authState.whenBooted()).resolves.toBeUndefined();
      warnSpy.mockRestore();
    });

    it('settles the boot outcome before the cart hydration, not after it', async () => {
      let bootStateAtCartCall: string | null = null;
      const { fixture, authState } = setup({ getSession: async () => SAMPLE_USER });
      const cart = TestBed.inject(CartService);
      vi.spyOn(cart, 'get').mockImplementation(async () => {
        bootStateAtCartCall = authState.bootState();
        return { items: [], itemCount: 0 } as never;
      });

      await flushBoot(fixture);

      expect(bootStateAtCartCall).toBe('booted');
    });
  });

  /**
   * Anonymous-cart merge on a full-page-load sign-in (plan F phase F2, finding
   * K4 / pass-2 A9).
   *
   * The interactive login form fires its own merge, but magic-link verify and
   * post-verification auto sign-in both land here as a fresh page load with a
   * session cookie already set. Without this call those customers lose the
   * basket they built before signing in.
   */
  describe('anonymous cart merge on boot', () => {
    it('merges once when the boot resolves a session', async () => {
      const { fixture, mergeSpy } = setup({ getSession: async () => SAMPLE_USER });
      await flushBoot(fixture);
      expect(mergeSpy).toHaveBeenCalledTimes(1);
    });

    it('does not merge for an anonymous boot', async () => {
      // The endpoint is `@RequireAuth()`, so calling it here would be a
      // guaranteed 401 on every single anonymous page load.
      const { fixture, mergeSpy } = setup({ getSession: async () => null });
      await flushBoot(fixture);
      expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('merges before hydrating the cart badge, so the count includes the guest lines', async () => {
      const order: string[] = [];
      const { fixture } = setup({ getSession: async () => SAMPLE_USER });
      const cart = TestBed.inject(CartService);
      vi.spyOn(cart, 'merge').mockImplementation(async () => {
        order.push('merge');
        return {} as never;
      });
      vi.spyOn(cart, 'get').mockImplementation(async () => {
        order.push('get');
        return { items: [], itemCount: 0 } as never;
      });
      await flushBoot(fixture);
      expect(order).toEqual(['merge', 'get']);
    });

    it('still hydrates the cart when the merge fails', async () => {
      // Same policy as the boot cart hydration: a failed merge is a lost
      // basket, not a shell that refuses to render.
      const { fixture, cartSpy } = setup({
        getSession: async () => SAMPLE_USER,
        merge: async () => {
          throw new Error('merge exploded');
        },
      });
      await flushBoot(fixture);
      expect(cartSpy).toHaveBeenCalled();
    });
  });

  it('passes axe-core WCAG 2.2 AA at the layout-shell scope', async () => {
    const { fixture } = setup();
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      // No router-outlet content rendered in test → no <main> body content;
      // skip rules that require route-level content presence.
      rules: {
        'page-has-heading-one': { enabled: false },
      },
    });
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
