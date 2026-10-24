import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, STOREFRONT_API_CLIENT, type ApiClient } from '@storefront-services';
import type { CustomerUser } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { AuthStateService } from '../../services/auth-state.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { AccountMenuComponent } from './account-menu.component';

const noopApi: ApiClient = {
  get: async () => ({}) as never,
  post: async () => ({}) as never,
  patch: async () => ({}) as never,
  delete: async () => ({}) as never,
  request: async () => ({}) as never,
};

const SAMPLE_USER: CustomerUser = {
  id: 'cus_1',
  email: 'kh@auth.test',
  firstName: 'Aisha',
  lastName: 'Karim',
  phone: null,
  avatarUrl: null,
  locale: 'fr',
  addresses: [],
};

describe('AccountMenuComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  function commonProviders(signOut: ReturnType<typeof vi.fn> = vi.fn(async () => undefined)) {
    return [
      provideRouter([{ path: '**', children: [] }]),
      LocaleService,
      AuthStateService,
      { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
      { provide: AuthService, useValue: { signOut } as unknown as AuthService },
    ];
  }

  it('renders an anchor link to /auth/login when anonymous', async () => {
    const fixture = await renderComponent(AccountMenuComponent, {}, commonProviders());
    const trigger = fixture.nativeElement.querySelector('[data-testid="account-menu-anonymous"]');
    expect(trigger?.tagName).toBe('A');
    expect(trigger?.getAttribute('href')).toBe('/fr/auth/login');
    expect(fixture.nativeElement.querySelector('[data-testid="account-menu-trigger"]')).toBeNull();
  });

  it('renders a button trigger and the menu panel when authed', async () => {
    const fixture = await renderComponent(AccountMenuComponent, {}, commonProviders());
    TestBed.inject(AuthStateService).setSession({ user: SAMPLE_USER });
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="account-menu-trigger"]',
    ) as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = fixture.nativeElement.querySelector(
      '[data-testid="account-menu-panel"]',
    ) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('menu');
    expect(panel.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('logout button calls authSvc.signOut, clears the session and navigates home', async () => {
    const signOut = vi.fn(async () => undefined);
    const fixture = await renderComponent(AccountMenuComponent, {}, commonProviders(signOut));
    const authState = TestBed.inject(AuthStateService);
    const router = TestBed.inject(Router);
    authState.setSession({ user: SAMPLE_USER });
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="account-menu-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const logout = fixture.nativeElement.querySelector(
      '[data-testid="account-menu-logout"]',
    ) as HTMLButtonElement;
    logout.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(authState.isAuthed()).toBe(false);
    expect(router.url).toMatch(/^\/(fr\/?)?$/);
  });

  it('renders zero serious or critical axe violations in the anonymous state', async () => {
    const fixture = await renderComponent(AccountMenuComponent, {}, commonProviders());
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['html-has-lang', 'landmark-one-main', 'region'],
    });
  });

  it('renders zero serious or critical axe violations in the authed open-menu state', async () => {
    const fixture = await renderComponent(AccountMenuComponent, {}, commonProviders());
    TestBed.inject(AuthStateService).setSession({ user: SAMPLE_USER });
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="account-menu-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await assertAxeClean(fixture.nativeElement, {
      disabledRules: ['html-has-lang', 'landmark-one-main', 'region'],
    });
  });
});
