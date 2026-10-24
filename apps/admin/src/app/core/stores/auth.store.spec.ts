import { TestBed } from '@angular/core/testing';
import type { AdminUser } from '@admin-types';
import { AuthStore } from './auth.store';

describe('AuthStore', () => {
  let store: AuthStore;

  const userFixture: AdminUser = {
    id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
    email: 'owner@example.com',
    firstName: 'Store',
    lastName: 'Owner',
    locale: 'ar',
    roles: [
      {
        id: 'a4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb',
        name: 'admin',
        permissions: ['orders:view', 'products:view'],
      },
    ],
    permissions: ['settings:view'],
    status: 'active',
    lastLoginAt: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(AuthStore);
  });

  it('bootstraps unauthenticated with the `fr` bootstrap locale', () => {
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.locale()).toBe('fr');
  });

  it('setSession hydrates the user and adopts the user locale', () => {
    store.setSession({ user: userFixture });
    expect(store.isAuthenticated()).toBe(true);
    expect(store.user()).toEqual(userFixture);
    expect(store.locale()).toBe('ar');
  });

  it('isAuthenticated derives purely from the user — there is no access token', () => {
    expect(store.isAuthenticated()).toBe(false);
    store.setSession({ user: userFixture });
    expect(store.isAuthenticated()).toBe(true);
    store.clear();
    expect(store.isAuthenticated()).toBe(false);
  });

  it('effectivePermissions merges role + direct permissions', () => {
    store.setSession({ user: userFixture });
    expect(store.hasPermission('orders:view')).toBe(true);
    expect(store.hasPermission('products:view')).toBe(true);
    expect(store.hasPermission('settings:view')).toBe(true);
    expect(store.hasPermission('admin_users:manage')).toBe(false);
  });

  it('hasAnyPermission checks the union', () => {
    store.setSession({ user: userFixture });
    expect(store.hasAnyPermission(['admin_users:manage', 'orders:view'])).toBe(true);
    expect(store.hasAnyPermission(['admin_users:manage'])).toBe(false);
  });

  it('setSession keeps the bootstrap locale when the user carries none', () => {
    store.setSession({ user: { ...userFixture, locale: null } });
    expect(store.locale()).toBe('fr');
    expect(store.isAuthenticated()).toBe(true);
  });

  it('setLocale updates the locale without touching auth state', () => {
    store.setSession({ user: userFixture });
    store.setLocale('fr');
    expect(store.locale()).toBe('fr');
    expect(store.isAuthenticated()).toBe(true);
  });

  it('clear wipes the user and resets the locale to the bootstrap value', () => {
    store.setSession({ user: userFixture });
    store.clear();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.locale()).toBe('fr');
  });
});
