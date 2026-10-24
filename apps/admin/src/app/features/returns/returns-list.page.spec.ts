import { ApiForbiddenError, ApiNotFoundError, ApiServerError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { ReturnsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ReturnsListPage } from './returns-list.page';

expect.extend(toHaveNoViolations);

describe('ReturnsListPage', () => {
  let fixture: ComponentFixture<ReturnsListPage>;
  let page: ReturnsListPage;
  let listSpy: jest.Mock;
  let analyticsSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;

  const listFixture = {
    data: [
      {
        id: 'return-1',
        returnNumber: 'RET-2026-0001',
        orderId: 'order-4',
        status: 'REQUESTED',
        reason: 'WRONG_SIZE',
        createdAt: '2026-04-15T12:00:00.000Z',
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  };

  const analyticsFixture = {
    totalReturns: 1,
    totalOrders: 4,
    returnRate: 25,
    byStatus: [{ status: 'REQUESTED', count: 1 }],
    byReason: [{ reason: 'WRONG_SIZE', count: 1 }],
    refundsByMethod: [{ method: 'ORIGINAL_PAYMENT', count: 1 }],
    topReturnedVariants: [],
  };

  function configure(params: Record<string, string> = {}) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: ReturnsService, useValue: { list: listSpy, analytics: analyticsSpy } },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: queryParams$.asObservable(), paramMap: of({ get: () => null }) },
        },
      ],
    });
    fixture = TestBed.createComponent(ReturnsListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    analyticsSpy = jest.fn(() => of(analyticsFixture));
  });

  it('fetches with default paging when no query params are present', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure();
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(page.total()).toBe(1);
    expect(page.loading()).toBe(false);
  });

  it('forwards valid status + reason filters from the URL', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'APPROVED', reason: 'WRONG_SIZE' });
    expect(listSpy).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      status: 'APPROVED',
      reason: 'WRONG_SIZE',
    });
  });

  it('silently drops an unknown status value', () => {
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
    page.setStatus('REQUESTED');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { status: 'REQUESTED', page: null },
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

  it('maps ApiNotFoundError to the returns-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Returns not found.');
  });

  it('renders the analytics strip when analytics() resolves', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure();
    expect(page.analytics()).toEqual(analyticsFixture);
  });

  it('suppresses the analytics strip when analytics() fails', () => {
    listSpy = jest.fn(() => of(listFixture));
    analyticsSpy = jest.fn(() =>
      throwError(() => new ApiServerError({ code: 'INTERNAL', message: 'boom', status: 500 })),
    );
    configure();
    expect(page.analytics()).toBeNull();
    // List still rendered
    expect(page.total()).toBe(1);
  });

  it('has no axe violations on the loaded table', async () => {
    listSpy = jest.fn(() => of(listFixture));
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
