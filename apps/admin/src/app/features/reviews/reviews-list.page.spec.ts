import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ReviewsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ReviewsListPage } from './reviews-list.page';

expect.extend(toHaveNoViolations);

describe('ReviewsListPage', () => {
  let fixture: ComponentFixture<ReviewsListPage>;
  let page: ReviewsListPage;
  let listSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;

  const listFixture = {
    data: [
      {
        id: 'review-1',
        productId: 'prod-1',
        userId: 'user-1',
        rating: 5,
        title: { default: 'Great', en: 'Great' },
        body: { default: 'Perfect fit, fast shipping.', en: 'Perfect fit, fast shipping.' },
        status: 'PENDING',
        createdAt: '2026-04-15T12:00:00.000Z',
        user: { id: 'user-1', firstName: 'Sara', lastName: 'Hassan' },
        product: { id: 'prod-1', slug: 'urban-runner-sneakers' },
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  };

  function configure(params: Record<string, string> = { status: 'PENDING' }) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: ReviewsService, useValue: { listReviews: listSpy } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: queryParams$.asObservable(),
            paramMap: of({ get: () => null }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ReviewsListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('fetches with PENDING status when the URL already carries it', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'PENDING' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: 'PENDING' });
    expect(page.total()).toBe(1);
    expect(page.loading()).toBe(false);
  });

  it('drops invalid status params rather than forwarding them', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'BOGUS' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('forwards PUBLISHED filter when URL specifies it', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'PUBLISHED' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: 'PUBLISHED' });
  });

  it('surfaces a user-safe error on ApiForbiddenError', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure({ status: 'PENDING' });
    expect(page.error()).toMatch(/permission/i);
    expect(page.loading()).toBe(false);
  });

  it('surfaces the reviews-not-found error on ApiNotFoundError', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure({ status: 'PENDING' });
    expect(page.error()).toBe('Reviews not found.');
  });

  it('renders the empty state when the list is empty', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure({ status: 'PENDING' });
    expect(page.rows()).toEqual([]);
    expect(page.total()).toBe(0);
  });

  it('truncates long review bodies for the list cell', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'PENDING' });
    const long = 'x'.repeat(120);
    expect(page.truncate(long).endsWith('…')).toBe(true);
    expect(page.truncate(null)).toBe('—');
  });

  it('is axe-clean', async () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'PENDING' });
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
