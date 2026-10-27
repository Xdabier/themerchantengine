import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { OrdersService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { OrdersListPage } from './orders-list.page';

expect.extend(toHaveNoViolations);

describe('OrdersListPage', () => {
  let fixture: ComponentFixture<OrdersListPage>;
  let page: OrdersListPage;
  let listSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;

  const listFixture = {
    data: [
      {
        id: 'order-1',
        orderNumber: 'ORD-2026-000001',
        status: 'DELIVERED',
        paymentStatus: 'CAPTURED',
        total: 500,
        currency: 'USD',
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:00:00.000Z',
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  };

  function configure(params: Record<string, string> = {}, exportSpy: jest.Mock = jest.fn()) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: OrdersService, useValue: { list: listSpy, exportCsv: exportSpy } },
        {
          provide: AuthStore,
          useValue: {
            hasPermission: () => false,
            currentUser: signal(null),
            permissions: signal<string[]>([]),
            locale: signal('fr'),
            isAuthenticated: signal(true),
            effectivePermissions: () => [] as string[],
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: queryParams$.asObservable(), paramMap: of({ get: () => null }) },
        },
      ],
    });
    fixture = TestBed.createComponent(OrdersListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('fetches with page=1 pageSize=20 by default', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure();
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(page.total()).toBe(1);
    expect(page.loading()).toBe(false);
  });

  it('forwards a valid status filter from the URL', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'CONFIRMED' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: 'CONFIRMED' });
  });

  it('silently drops an unknown status (never sends it)', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'BOGUS' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('re-fetches when query params change', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ page: '1' });
    expect(listSpy).toHaveBeenCalledTimes(1);
    queryParams$.next({ page: '2' });
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
  });

  it('setStatus() writes status + resets page via the router', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockReturnValue(Promise.resolve(true));
    page.setStatus('SHIPPED');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { status: 'SHIPPED', page: null },
        queryParamsHandling: 'merge',
      }),
    );
  });

  it('maps ApiForbiddenError to a permission-safe message', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('maps ApiNotFoundError to the Orders-not-found message', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Orders not found.');
  });

  it('clamps goToPage() within 1..totalPages', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockReturnValue(Promise.resolve(true));
    page.goToPage(0);
    page.goToPage(9999);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('has no axe violations on the loaded table', async () => {
    listSpy = jest.fn(() => of(listFixture));
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  // ── QA D2: who placed the order, and how to find it ───────────────────────

  function rowText(): string {
    const row = fixture.nativeElement.querySelector(
      '[data-testid="order-row-order-1"]',
    ) as HTMLElement | null;
    return (row?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('renders the customer name in its own column', () => {
    listSpy = jest.fn(() =>
      of({
        ...listFixture,
        data: [
          {
            ...listFixture.data[0],
            userId: '9f1c1d3e-1a1a-4a4a-8a8a-111111111111',
            user: {
              id: '9f1c1d3e-1a1a-4a4a-8a8a-111111111111',
              email: 'sara@example.com',
              firstName: 'Sara',
              lastName: 'Hassan',
            },
          },
        ],
      }),
    );
    configure();
    expect(rowText()).toContain('Sara Hassan');
    expect(rowText()).not.toContain('9f1c1d3e-1a1a-4a4a-8a8a-111111111111');
  });

  it('falls back to Guest when the order carries no user', () => {
    listSpy = jest.fn(() => of({ ...listFixture, data: [{ ...listFixture.data[0], user: null }] }));
    configure();
    expect(rowText()).toContain('Guest');
  });

  it('exposes a search box wired to the search URL param', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ search: 'sara' });
    const input = fixture.nativeElement.querySelector(
      '[data-testid="orders-search"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('sara');
  });

  it('onSearch debounces then writes search + resets page', (done) => {
    listSpy = jest.fn(() => of(listFixture));
    configure();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockReturnValue(Promise.resolve(true));
    page.onSearch({ target: { value: 'sara' } } as unknown as Event);
    setTimeout(() => {
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { search: 'sara', page: null },
          queryParamsHandling: 'merge',
        }),
      );
      done();
    }, 300);
  });

  it('forwards the search term from the URL to the list call', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ search: '  sara  ' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, search: 'sara' });
  });

  it('forwards the search term to the CSV export', () => {
    listSpy = jest.fn(() => of(listFixture));
    const exportSpy = jest.fn(() => of(new Blob(['id\n'], { type: 'text/csv' })));
    configure({ search: 'sara', status: 'CONFIRMED' }, exportSpy);
    page.exportCsv();
    expect(exportSpy).toHaveBeenCalledWith({ status: 'CONFIRMED', search: 'sara' });
  });
});
