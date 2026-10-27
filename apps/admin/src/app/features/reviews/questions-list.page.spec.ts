import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { ReviewsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { QuestionsListPage } from './questions-list.page';

expect.extend(toHaveNoViolations);

describe('QuestionsListPage', () => {
  let fixture: ComponentFixture<QuestionsListPage>;
  let page: QuestionsListPage;
  let listSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;

  const listFixture = {
    data: [
      {
        id: 'question-1',
        productId: 'prod-1',
        askedById: 'user-1',
        question: { default: 'What size should I pick?', en: 'What size should I pick?' },
        status: 'PENDING',
        createdAt: '2026-04-15T12:00:00.000Z',
        asker: { id: 'user-1', firstName: 'Sara', lastName: 'Hassan' },
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
        { provide: ReviewsService, useValue: { listQuestions: listSpy } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: queryParams$.asObservable(),
            paramMap: of({ get: () => null }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(QuestionsListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('fetches with PENDING status when the URL carries it', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'PENDING' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: 'PENDING' });
    expect(page.total()).toBe(1);
  });

  it('forwards PUBLISHED when URL specifies it', () => {
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
  });

  it('surfaces the questions-not-found error on ApiNotFoundError', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure({ status: 'PENDING' });
    expect(page.error()).toBe('Questions not found.');
  });

  it('renders the empty state when the list is empty', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure({ status: 'PENDING' });
    expect(page.rows()).toEqual([]);
  });

  it('is axe-clean', async () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'PENDING' });
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  // ── QA D6 sweep: the backend accepts `search`, the page had no box ────────

  it('renders a search box seeded from the URL and forwards the term', () => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'PENDING', search: 'size' });
    const input = fixture.nativeElement.querySelector(
      '[data-testid="questions-search"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('size');
    expect(listSpy).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      status: 'PENDING',
      search: 'size',
    });
  });

  it('onSearch debounces then writes search + resets page', (done) => {
    listSpy = jest.fn(() => of(listFixture));
    configure({ status: 'PENDING' });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockReturnValue(Promise.resolve(true));
    page.onSearch({ target: { value: 'size' } } as unknown as Event);
    setTimeout(() => {
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { search: 'size', page: null },
          queryParamsHandling: 'merge',
        }),
      );
      done();
    }, 300);
  });
});
