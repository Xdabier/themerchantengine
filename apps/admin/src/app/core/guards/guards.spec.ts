import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import type { AdminUser } from '@admin-types';
import { authGuard } from './auth.guard';
import { guestOnlyGuard } from './guest-only.guard';
import { permissionGuard } from './permission.guard';
import { AuthStore } from '../stores/auth.store';

const fakeUser: AdminUser = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
  email: 'owner@example.com',
  roles: [
    { id: 'a4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb', name: 'admin', permissions: ['orders:view'] },
  ],
  permissions: [],
  status: 'active',
};

const state = (url: string): RouterStateSnapshot => ({ url }) as RouterStateSnapshot;
const route = {} as ActivatedRouteSnapshot;

describe('authGuard', () => {
  let store: AuthStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            createUrlTree: jest.fn((cmds, extras) => ({ cmds, extras }) as unknown as UrlTree),
          },
        },
      ],
    });
    store = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
  });

  it('returns true when authenticated', () => {
    store.setSession({ user: fakeUser });
    const result = TestBed.runInInjectionContext(() => authGuard(route, state('/orders')));
    expect(result).toBe(true);
  });

  it('returns a UrlTree to /auth/login with returnTo when unauthenticated', () => {
    const result = TestBed.runInInjectionContext(() => authGuard(route, state('/orders/123')));
    expect(router.createUrlTree).toHaveBeenCalledWith(['/auth/login'], {
      queryParams: { returnTo: '/orders/123' },
    });
    expect(result).not.toBe(true);
  });
});

describe('guestOnlyGuard', () => {
  let store: AuthStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: { createUrlTree: jest.fn((cmds) => ({ cmds }) as unknown as UrlTree) },
        },
      ],
    });
    store = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
  });

  it('returns true when unauthenticated', () => {
    const result = TestBed.runInInjectionContext(() => guestOnlyGuard(route, state('/auth/login')));
    expect(result).toBe(true);
  });

  it('redirects home when already authenticated', () => {
    store.setSession({ user: fakeUser });
    const result = TestBed.runInInjectionContext(() => guestOnlyGuard(route, state('/auth/login')));
    expect(router.createUrlTree).toHaveBeenCalledWith(['/']);
    expect(result).not.toBe(true);
  });
});

describe('permissionGuard', () => {
  let store: AuthStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            createUrlTree: jest.fn((cmds, extras) => ({ cmds, extras }) as unknown as UrlTree),
          },
        },
      ],
    });
    store = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
  });

  it('allows navigation when user has the required permission', () => {
    store.setSession({ user: fakeUser });
    const guard = permissionGuard('orders:view');
    const result = TestBed.runInInjectionContext(() => guard(route, state('/orders')));
    expect(result).toBe(true);
  });

  it('redirects to /403 when user is authenticated but lacks permission', () => {
    store.setSession({ user: fakeUser });
    const guard = permissionGuard('admin_users:manage');
    const result = TestBed.runInInjectionContext(() => guard(route, state('/roles')));
    expect(router.createUrlTree).toHaveBeenCalledWith(['/403']);
    expect(result).not.toBe(true);
  });

  it('redirects to /auth/login with returnTo when unauthenticated', () => {
    const guard = permissionGuard('orders:view');
    const result = TestBed.runInInjectionContext(() => guard(route, state('/orders')));
    expect(router.createUrlTree).toHaveBeenCalledWith(['/auth/login'], {
      queryParams: { returnTo: '/orders' },
    });
    expect(result).not.toBe(true);
  });

  it('accepts an array of permissions (any-of semantics)', () => {
    store.setSession({ user: fakeUser });
    const guard = permissionGuard(['admin_users:manage', 'orders:view']);
    const result = TestBed.runInInjectionContext(() => guard(route, state('/orders')));
    expect(result).toBe(true);
  });
});
