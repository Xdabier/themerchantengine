import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersService } from '@storefront-services';
import type { Order } from '@storefront-types';

import { LocaleService } from '../../../../locale.service';
import { AuthStateService } from '../../../../services/auth-state.service';
import { getChromeStrings } from '../../../../../i18n';
import { type Locale } from '../../../../../i18n/types';
import AccountOrdersPage from './index.page';
import { fixtureChromeIdentity } from '../../../../../test-support/store-config-fixtures';

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

function makeAuth(authed: boolean) {
  return {
    isAuthed: () => authed,
    // The page awaits the boot outcome before deciding (finding N4); these
    // stubs model a boot that has already settled.
    whenBooted: async () => undefined,
    bootState: () => 'booted',
    currentUser: () => null,
    clearSession: vi.fn(),
  } as unknown as AuthStateService;
}

const sampleOrders: Order[] = [
  {
    id: 'o1',
    orderNumber: 'AKL-0001',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    items: [],
    subtotal: '100',
    total: '100',
    currency: 'AED',
    createdAt: '2026-04-25T10:00:00Z',
  } as Order,
  {
    id: 'o2',
    orderNumber: 'AKL-0002',
    status: 'SHIPPED',
    paymentStatus: 'PENDING',
    items: [],
    subtotal: '200',
    total: '200',
    currency: 'AED',
    createdAt: '2026-04-26T10:00:00Z',
  } as Order,
];

interface RenderResult {
  fixture: ComponentFixture<AccountOrdersPage>;
  navigateSpy: ReturnType<typeof vi.fn>;
  ordersSpy: ReturnType<typeof vi.fn>;
}

async function renderOrders(opts: {
  locale: Locale;
  authed: boolean;
  data?: Order[];
  total?: number;
}): Promise<RenderResult> {
  const stub = new StubLocaleService(opts.locale);
  const auth = makeAuth(opts.authed);
  const data = opts.data ?? sampleOrders;
  const ordersSpy = vi.fn(async () => ({
    data,
    meta: { page: 1, pageSize: 10, total: opts.total ?? data.length },
  }));
  const ordersSvc = { list: ordersSpy } as unknown as OrdersService;

  TestBed.overrideComponent(AccountOrdersPage, {
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
  router.navigate = navigateSpy as never;
  const fixture = TestBed.createComponent(AccountOrdersPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  // Second flush: the page now awaits the session boot outcome before it even
  // reaches its data load (finding N4), so the load settles one turn later.
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, navigateSpy, ordersSpy };
}

describe('AccountOrdersPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the SSR shell with title + filter chips + order rows', async () => {
    const { fixture } = await renderOrders({ locale: 'fr', authed: true });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="account-orders-page"]')).not.toBeNull();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Mes commandes');
    const chips = root.querySelectorAll('[data-testid^="account-orders-filter-"]');
    expect(chips.length).toBe(6);
  });

  it('redirects an anonymous visitor to /auth/login with from=/account/orders', async () => {
    const { navigateSpy } = await renderOrders({ locale: 'en', authed: false });
    expect(navigateSpy).toHaveBeenCalled();
    const target = navigateSpy.mock.calls[0][0];
    expect(target).toBe('/en/auth/login?from=%2Fen%2Faccount%2Forders');
  });

  it('renders one order row per result', async () => {
    const { fixture } = await renderOrders({ locale: 'en', authed: true });
    const items = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="account-orders-list"] li',
    );
    expect(items.length).toBe(2);
  });

  it('passes status to OrdersService.list when a status chip is clicked', async () => {
    const { fixture, ordersSpy } = await renderOrders({ locale: 'en', authed: true });
    const shippedBtn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="account-orders-filter-SHIPPED"]',
    ) as HTMLButtonElement;
    shippedBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(ordersSpy).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, status: 'SHIPPED' });
  });

  it('omits status from the query when the "all" chip is active', async () => {
    const { ordersSpy } = await renderOrders({ locale: 'en', authed: true });
    const lastCall = ordersSpy.mock.calls[ordersSpy.mock.calls.length - 1][0] as Record<
      string,
      unknown
    >;
    expect(lastCall).toEqual({ page: 1, pageSize: 10 });
  });

  it('renders the empty state when the API returns no orders', async () => {
    const { fixture } = await renderOrders({ locale: 'en', authed: true, data: [], total: 0 });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="account-orders-empty"]'),
    ).not.toBeNull();
  });

  it('shows pagination controls when total > pageSize', async () => {
    const { fixture } = await renderOrders({ locale: 'en', authed: true, total: 25 });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="account-orders-pagination"]',
      ),
    ).not.toBeNull();
  });
});
