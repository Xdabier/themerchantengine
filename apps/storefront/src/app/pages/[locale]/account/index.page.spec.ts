import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersService } from '@storefront-services';
import type { Order } from '@storefront-types';

import { LocaleService } from '../../../locale.service';
import { AuthStateService } from '../../../services/auth-state.service';
import { getChromeStrings } from '../../../../i18n';
import { type Locale } from '../../../../i18n/types';
import AccountPage from './index.page';
import { fixtureChromeIdentity } from '../../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
  // The shared account nav derives `aria-current` from the live URL.
  readonly currentUrl = () => `/${this._locale()}/account`;
}

function makeAuth(authed: boolean, firstName: string | null = null) {
  return {
    isAuthed: () => authed,
    // The page awaits the boot outcome before deciding (finding N4); these
    // stubs model a boot that has already settled.
    whenBooted: async () => undefined,
    bootState: () => 'booted',
    currentUser: () => (firstName ? ({ firstName, lastName: null } as never) : null),
    clearSession: vi.fn(),
  } as unknown as AuthStateService;
}

function makeOrdersStub(orders: Order[] = []) {
  return {
    list: vi.fn(async () => ({
      data: orders,
      meta: { page: 1, pageSize: orders.length || 3, total: orders.length },
    })),
  } as unknown as OrdersService;
}

const sampleOrder: Order = {
  id: 'o1',
  orderNumber: 'AKL-0001',
  status: 'PENDING',
  paymentStatus: 'PENDING',
  items: [],
  subtotal: '215.00',
  total: '215.00',
  currency: 'AED',
  createdAt: '2026-04-25T10:00:00Z',
} as Order;

interface RenderResult {
  fixture: ComponentFixture<AccountPage>;
  navigateSpy: ReturnType<typeof vi.fn>;
}

async function renderAccount(opts: {
  locale: Locale;
  authed: boolean;
  firstName?: string | null;
  orders?: Order[];
  ordersThrows?: unknown;
}): Promise<RenderResult> {
  const stub = new StubLocaleService(opts.locale);
  const auth = makeAuth(opts.authed, opts.firstName ?? null);
  const ordersSvc = opts.ordersThrows
    ? ({
        list: vi.fn(async () => {
          throw opts.ordersThrows;
        }),
      } as unknown as OrdersService)
    : makeOrdersStub(opts.orders);

  TestBed.overrideComponent(AccountPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocaleService, useValue: stub },
      { provide: AuthStateService, useValue: auth },
      { provide: OrdersService, useValue: ordersSvc },
    ],
  });
  const router = TestBed.inject(Router);
  const navigateSpy = vi.fn(async () => true);
  router.navigateByUrl = navigateSpy as never;
  const fixture = TestBed.createComponent(AccountPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  // Second flush: the page now awaits the session boot outcome before it even
  // reaches its data load (finding N4), so the load settles one turn later.
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, navigateSpy };
}

describe('AccountPage (index)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the SSR shell with title + 6 quick links + recent-orders section', async () => {
    const { fixture } = await renderAccount({ locale: 'fr', authed: true, orders: [sampleOrder] });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="account-page"]')).not.toBeNull();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Mon compte');
    // NE7 added the "Email preferences" quick-link (orders, addresses, wishlist,
    // profile, returns, preferences).
    expect(root.querySelectorAll('[data-testid^="account-quick-link-"]').length).toBe(6);
  });

  it('shows the personalized greeting when the auth state has a firstName', async () => {
    const { fixture } = await renderAccount({
      locale: 'en',
      authed: true,
      firstName: 'Jane',
      orders: [],
    });
    const greeting = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="account-page-greeting"]',
    );
    expect(greeting?.textContent?.trim()).toBe('Welcome back, Jane.');
  });

  it('redirects an anonymous visitor to /auth/login with from=/account', async () => {
    const { navigateSpy } = await renderAccount({ locale: 'fr', authed: false });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0][0]).toBe('/fr/auth/login?from=%2Ffr%2Faccount');
  });

  it('renders the recent-orders empty state when the API returns no rows', async () => {
    const { fixture } = await renderAccount({ locale: 'en', authed: true, orders: [] });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="account-recent-empty"]')).not.toBeNull();
  });

  it('renders one OrderRow per recent order', async () => {
    const { fixture } = await renderAccount({
      locale: 'en',
      authed: true,
      orders: [sampleOrder, { ...sampleOrder, id: 'o2', orderNumber: 'AKL-0002' }],
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-testid="account-recent-orders"] li').length).toBe(2);
  });

  it('renders the error branch when OrdersService.list throws a StorefrontError', async () => {
    const { StorefrontServerError } = await import('@storefront-types');
    const { fixture } = await renderAccount({
      locale: 'en',
      authed: true,
      ordersThrows: new StorefrontServerError({ code: 'SERVER', message: 'boom' }),
    });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="account-recent-error"]'),
    ).not.toBeNull();
  });
});
