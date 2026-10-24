import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZoneChangeDetection, signal } from '@angular/core';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { MobileBottomNavComponent } from './mobile-bottom-nav.component';
import { LocaleService } from '../locale.service';
import { AuthStateService } from '../services/auth-state.service';
import { CartService, STOREFRONT_API_CLIENT, type ApiClient } from '@storefront-services';
import { getChromeStrings } from '../../i18n';
import type { Locale } from '../../i18n/types';

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

function setup(locale: Locale = 'fr', url = '/fr/', authed = false) {
  const fakeLocale = new FakeLocaleService();
  fakeLocale.set(locale, url);
  const authState = new AuthStateService();
  if (authed) {
    authState.setSession({ user: { id: 'u-1', email: 'a@b.co' } as never });
  }
  authState.markBooted();
  TestBed.configureTestingModule({
    imports: [MobileBottomNavComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([]),
      { provide: LocaleService, useValue: fakeLocale },
      { provide: AuthStateService, useValue: authState },
      { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
    ],
  });
  const fixture = TestBed.createComponent(MobileBottomNavComponent);
  fixture.detectChanges();
  return { fixture, fakeLocale, authState, cart: TestBed.inject(CartService) };
}

function accountHref(fixture: { nativeElement: HTMLElement }): string | null {
  const link = fixture.nativeElement.querySelector(
    '[data-testid="bottom-nav-account"]',
  ) as HTMLAnchorElement | null;
  return link?.getAttribute('href') ?? null;
}

describe('MobileBottomNavComponent', () => {
  it('renders four destinations in order: home, search, cart, account', () => {
    const { fixture } = setup();
    const ids = ['bottom-nav-home', 'bottom-nav-search', 'bottom-nav-cart', 'bottom-nav-account'];
    const links = ids.map(
      (id) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLAnchorElement,
    );
    expect(links.every((l) => l !== null)).toBe(true);
    const order = Array.from(
      fixture.nativeElement.querySelectorAll('a[data-testid^="bottom-nav-"]'),
    ).map((a) => (a as HTMLElement).getAttribute('data-testid'));
    expect(order).toEqual(ids);
  });

  it('renders the navigation landmark with bilingual aria-label (en + fr)', () => {
    const { fixture, fakeLocale } = setup('en', '/en/');
    let nav = fixture.nativeElement.querySelector('nav[aria-label]') as HTMLElement;
    expect(nav.getAttribute('aria-label')).toBe('Bottom navigation');
    // Explicit role per tasks.md S4.6 — kept so external selectors that target
    // `nav[role="navigation"]` (e2e smoke spec) resolve consistently.
    expect(nav.getAttribute('role')).toBe('navigation');

    fakeLocale.set('fr', '/fr/');
    fixture.detectChanges();
    nav = fixture.nativeElement.querySelector('nav[aria-label]') as HTMLElement;
    expect(nav.getAttribute('aria-label')).toBe('Navigation principale');
  });

  it('marks aria-current=page on the matching route', () => {
    const { fixture } = setup('en', '/en/cart');
    const cart = fixture.nativeElement.querySelector(
      '[data-testid="bottom-nav-cart"]',
    ) as HTMLElement;
    expect(cart.getAttribute('aria-current')).toBe('page');

    const home = fixture.nativeElement.querySelector(
      '[data-testid="bottom-nav-home"]',
    ) as HTMLElement;
    expect(home.getAttribute('aria-current')).toBeNull();
  });

  it('marks home as active on bare locale root', () => {
    const { fixture } = setup('fr', '/fr/');
    const home = fixture.nativeElement.querySelector(
      '[data-testid="bottom-nav-home"]',
    ) as HTMLElement;
    expect(home.getAttribute('aria-current')).toBe('page');
  });

  it('marks account active on /auth/* and /account/*', () => {
    const { fixture, fakeLocale } = setup('en', '/en/auth/login');
    const account = fixture.nativeElement.querySelector(
      '[data-testid="bottom-nav-account"]',
    ) as HTMLElement;
    expect(account.getAttribute('aria-current')).toBe('page');
    fakeLocale.set('en', '/en/account/orders');
    fixture.detectChanges();
    expect(account.getAttribute('aria-current')).toBe('page');
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const { fixture } = setup();
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: {
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
      },
    });
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  it('hides the cart badge at count=0 and renders it aria-hidden on > 0', () => {
    const { fixture, cart } = setup();
    expect(fixture.nativeElement.querySelector('[data-testid="bottom-nav-cart-badge"]')).toBeNull();
    (cart as unknown as { _itemCount: { set: (n: number) => void } })._itemCount.set(7);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector(
      '[data-testid="bottom-nav-cart-badge"]',
    ) as HTMLElement;
    expect(badge.textContent?.trim()).toBe('7');
    // The visible badge is aria-hidden; the polite live region lives in
    // HeaderComponent so the count is announced once even though both
    // surfaces are simultaneously visible on mobile.
    expect(badge.getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * Finding N1. The Account tab was hardcoded to the login route by a stale S9
   * placeholder, so a signed-in customer tapping Account on mobile got a
   * sign-in form.
   */
  describe('auth-aware account tab (finding N1)', () => {
    it('points an anonymous visitor at the login route', () => {
      const { fixture } = setup('fr', '/fr/', false);
      expect(accountHref(fixture)).toBe('/fr/auth/login');
    });

    it('points a signed-in customer at the account dashboard', () => {
      const { fixture } = setup('fr', '/fr/', true);
      expect(accountHref(fixture)).toBe('/fr/account');
    });

    it('honours the active locale when anonymous', () => {
      expect(accountHref(setup('en', '/en/', false).fixture)).toBe('/en/auth/login');
    });

    it('honours the active locale when signed in', () => {
      expect(accountHref(setup('en', '/en/', true).fixture)).toBe('/en/account');
    });

    it('self-upgrades the destination when the session commits mid-render', () => {
      const { fixture, authState } = setup('fr', '/fr/', false);
      expect(accountHref(fixture)).toBe('/fr/auth/login');

      authState.setSession({ user: { id: 'u-2', email: 'late@b.co' } as never });
      fixture.detectChanges();

      expect(accountHref(fixture)).toBe('/fr/account');
    });
  });
});
