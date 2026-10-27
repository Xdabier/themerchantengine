import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '@storefront-services';

import { LocaleService } from '../../locale.service';
import { AuthStateService } from '../../services/auth-state.service';
import { getChromeStrings } from '../../../i18n';
import { type Locale } from '../../../i18n/types';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { AccountNavComponent } from './account-nav.component';
import { fixtureChromeIdentity } from '../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  private readonly _url: WritableSignal<string>;
  constructor(initial: Locale, url: string) {
    this._locale = signal<Locale>(initial);
    this._url = signal(url);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly currentUrl = () => this._url();
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
}

async function render(opts: { locale?: Locale; url?: string } = {}) {
  const locale = opts.locale ?? 'en';
  const signOut = vi.fn(async () => undefined);
  const clearSession = vi.fn();
  const fixture = await renderComponent(AccountNavComponent, {}, [
    provideRouter([]),
    { provide: LocaleService, useValue: new StubLocaleService(locale, opts.url ?? '/en/account') },
    { provide: AuthService, useValue: { signOut } as unknown as AuthService },
    {
      provide: AuthStateService,
      useValue: { clearSession, isAuthed: () => true } as unknown as AuthStateService,
    },
  ]);
  const router = TestBed.inject(Router);
  const navigated: string[] = [];
  vi.spyOn(router, 'navigateByUrl').mockImplementation(async (url) => {
    navigated.push(String(url));
    return true;
  });
  return { fixture, signOut, clearSession, navigated };
}

function hrefOf(fixture: ComponentFixture<AccountNavComponent>, key: string): string | null {
  return (
    (fixture.nativeElement as HTMLElement)
      .querySelector(`[data-testid="account-nav-${key}"]`)
      ?.getAttribute('href') ?? null
  );
}

/**
 * Findings A2 and A5. The account area had no cross-links, so reaching
 * addresses from orders meant going back through the header menu, and sign-out
 * existed nowhere but that menu.
 */
describe('AccountNavComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('links every account section, locale-prefixed', async () => {
    const { fixture } = await render({ locale: 'en' });
    expect(hrefOf(fixture, 'dashboard')).toBe('/en/account');
    expect(hrefOf(fixture, 'orders')).toBe('/en/account/orders');
    expect(hrefOf(fixture, 'addresses')).toBe('/en/account/addresses');
    expect(hrefOf(fixture, 'wishlist')).toBe('/en/account/wishlist');
    expect(hrefOf(fixture, 'profile')).toBe('/en/account/profile');
    expect(hrefOf(fixture, 'preferences')).toBe('/en/account/preferences');
    expect(hrefOf(fixture, 'returns')).toBe('/en/account/returns');
  });

  it('follows the active locale', async () => {
    const { fixture } = await render({ locale: 'fr', url: '/fr/account' });
    expect(hrefOf(fixture, 'orders')).toBe('/fr/account/orders');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      getChromeStrings('fr').account.nav.orders,
    );
  });

  function currentKeys(fixture: ComponentFixture<AccountNavComponent>): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[aria-current="page"]'),
    ).map((el) => el.getAttribute('data-testid') ?? '');
  }

  it('marks exactly the dashboard as current on the account index', async () => {
    const { fixture } = await render({ url: '/en/account' });
    expect(currentKeys(fixture)).toEqual(['account-nav-dashboard']);
  });

  it('keeps orders current on an order detail page, and the dashboard not', async () => {
    // The dashboard href is a prefix of every account route, which is why it
    // needs an exact match and the rest do not.
    const { fixture } = await render({ url: '/en/account/orders/ORD-1' });
    expect(currentKeys(fixture)).toEqual(['account-nav-orders']);
  });

  it('ignores query and fragment when deciding the current section', async () => {
    const { fixture } = await render({ url: '/en/account/orders?page=2#top' });
    expect(currentKeys(fixture)).toEqual(['account-nav-orders']);
  });

  it('signs out through the shared helper and lands on the locale home', async () => {
    const { fixture, signOut, clearSession, navigated } = await render({ locale: 'fr' });
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button[data-testid="account-nav-sign-out"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    button.click();
    await fixture.whenStable();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigated).toEqual(['/fr/']);
  });

  it('renders zero serious or critical axe violations', async () => {
    const { fixture } = await render();
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['html-has-lang', 'landmark-one-main', 'region'],
    });
  });
});
