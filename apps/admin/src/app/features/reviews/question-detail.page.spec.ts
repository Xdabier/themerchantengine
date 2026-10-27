import { Dialog } from '@angular/cdk/dialog';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ReviewsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { QuestionDetailPage } from './question-detail.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

describe('QuestionDetailPage', () => {
  let fixture: ComponentFixture<QuestionDetailPage>;
  let page: QuestionDetailPage;
  let listSpy: jest.Mock;
  let approveSpy: jest.Mock;
  let paramMap$: BehaviorSubject<{ get(k: string): string | null }>;
  let dialogOpenSpy: jest.Mock;
  let answerSpy: jest.Mock;

  const questionFixture = {
    id: 'question-1',
    productId: 'prod-1',
    askedById: 'user-1',
    question: { default: 'What size should I pick?', en: 'What size should I pick?' },
    status: 'PENDING',
    createdAt: '2026-04-15T12:00:00.000Z',
    asker: { id: 'user-1', firstName: 'Sara', lastName: 'Hassan' },
    product: { id: 'prod-1', slug: 'urban-runner-sneakers' },
  };

  function configure(permissionHeld = true) {
    dialogOpenSpy ??= jest.fn();
    paramMap$ = new BehaviorSubject<{ get(k: string): string | null }>({
      get: (k: string) => (k === 'id' ? 'question-1' : null),
    });
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: ReviewsService,
          useValue: {
            listQuestions: listSpy,
            approveQuestion: approveSpy,
            rejectQuestion: jest.fn(() => of({ ...questionFixture, status: 'HIDDEN' })),
            answerQuestion: answerSpy,
          },
        },
        {
          provide: AuthStore,
          useValue: {
            hasPermission: (p: string) => permissionHeld && p === 'reviews:update',
            locale: () => 'en',
          },
        },
        { provide: Dialog, useValue: { open: dialogOpenSpy } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable(), queryParams: of({}) },
        },
      ],
    });
    fixture = TestBed.createComponent(QuestionDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: [questionFixture], meta: { page: 1, pageSize: 100, total: 1 } }),
    );
    approveSpy = jest.fn(() => of({ ...questionFixture, status: 'PUBLISHED' }));
    answerSpy = jest.fn(() =>
      of({
        ...questionFixture,
        answer: { default: 'Sized right.', en: 'Sized right.' },
        isAdminAnswer: true,
      }),
    );
    dialogOpenSpy = jest.fn();
  });

  it('loads the question by id from the list endpoint', () => {
    configure();
    expect(listSpy).toHaveBeenCalled();
    expect(page.question()?.id).toBe('question-1');
  });

  it('surfaces an error when no match is found', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }));
    configure();
    expect(page.error()).toMatch(/not found/i);
  });

  it('approve flips the status to PUBLISHED optimistically', () => {
    configure();
    page.approve();
    expect(approveSpy).toHaveBeenCalledWith('question-1');
    expect(page.question()?.status).toBe('PUBLISHED');
  });

  /**
   * Answering used to leave the question PENDING and Approve was a separate
   * button, so an operator who answered and forgot to approve ended up with an
   * answered question no customer could see.
   */
  it('publishes in the same gesture when the answer dialog asks it to', async () => {
    configure();
    dialogOpenSpy.mockReturnValue({
      closed: of({ answer: 'Sized right.', isAdminAnswer: true, publish: true }),
    });

    await page.answer();

    expect(answerSpy).toHaveBeenCalledWith('question-1', {
      answer: 'Sized right.',
      isAdminAnswer: true,
    });
    expect(approveSpy).toHaveBeenCalledWith('question-1');
    expect(page.question()?.status).toBe('PUBLISHED');
  });

  it('leaves the status alone when the operator clears the publish toggle', async () => {
    configure();
    dialogOpenSpy.mockReturnValue({
      closed: of({ answer: 'Draft reply.', isAdminAnswer: true, publish: false }),
    });

    await page.answer();

    expect(answerSpy).toHaveBeenCalled();
    expect(approveSpy).not.toHaveBeenCalled();
    expect(page.question()?.status).toBe('PENDING');
  });

  it('hands the dialog the question status so it can offer the right control', async () => {
    configure();
    dialogOpenSpy.mockReturnValue({ closed: of(null) });

    await page.answer();

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  it('gates actions when the user lacks reviews:update', () => {
    configure(false);
    expect(page.canManage()).toBe(false);
  });

  it('formats ApiForbiddenError with a permission-safe message', () => {
    approveSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.approve();
    expect(page.error()).toMatch(/permission/i);
  });

  it('formats ApiNotFoundError with the question-not-found message', () => {
    approveSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.approve();
    expect(page.error()).toBe('Question not found.');
  });

  it('is axe-clean on the detail surface', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
