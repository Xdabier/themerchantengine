import { Dialog } from '@angular/cdk/dialog';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ReviewsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ReviewDetailPage } from './review-detail.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

describe('ReviewDetailPage', () => {
  let fixture: ComponentFixture<ReviewDetailPage>;
  let page: ReviewDetailPage;
  let listSpy: jest.Mock;
  let approveSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let deleteSpy: jest.Mock;
  let dialogOpenSpy: jest.Mock;
  let paramMap$: BehaviorSubject<{ get(k: string): string | null }>;

  const reviewFixture = {
    id: 'review-1',
    productId: 'prod-1',
    userId: 'user-1',
    rating: 4,
    title: { default: 'Nice fit', en: 'Nice fit' },
    body: { default: 'Comfortable and stylish.', en: 'Comfortable and stylish.' },
    status: 'PENDING',
    createdAt: '2026-04-15T12:00:00.000Z',
    helpfulCount: 2,
    verifiedPurchase: true,
    user: { id: 'user-1', firstName: 'Sara', lastName: 'Hassan' },
    product: { id: 'prod-1', slug: 'urban-runner-sneakers' },
  };

  function configure(permissionHeld = true, withDelete = false) {
    paramMap$ = new BehaviorSubject<{ get(k: string): string | null }>({
      get: (k: string) => (k === 'id' ? 'review-1' : null),
    });
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: ReviewsService,
          useValue: {
            listReviews: listSpy,
            approveReview: approveSpy,
            rejectReview: jest.fn(() => of({ ...reviewFixture, status: 'HIDDEN' })),
            updateReview: updateSpy,
            deleteReview: deleteSpy,
          },
        },
        {
          provide: AuthStore,
          useValue: {
            hasPermission: (p: string) => {
              if (!permissionHeld) return false;
              if (p === 'reviews:update') return true;
              if (p === 'reviews:delete') return withDelete;
              return false;
            },
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
    fixture = TestBed.createComponent(ReviewDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  function makeDialogRef(closeValue: unknown) {
    return {
      closed: {
        subscribe: (fn: (v: unknown) => void) => ({
          unsubscribe: () => undefined,
          _: fn(closeValue),
        }),
      },
    };
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: [reviewFixture], meta: { page: 1, pageSize: 100, total: 1 } }),
    );
    approveSpy = jest.fn(() => of({ ...reviewFixture, status: 'PUBLISHED' }));
    updateSpy = jest.fn(() =>
      of({
        ...reviewFixture,
        body: { default: 'Edited body', en: 'Edited body' },
        status: 'PUBLISHED',
      }),
    );
    deleteSpy = jest.fn(() => of(undefined));
    dialogOpenSpy = jest.fn();
  });

  it('loads the review by id from the list endpoint', () => {
    configure();
    expect(listSpy).toHaveBeenCalled();
    expect(page.review()?.id).toBe('review-1');
    expect(page.loading()).toBe(false);
  });

  it('surfaces an error when no match is found', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }));
    configure();
    expect(page.error()).toMatch(/not found/i);
  });

  it('approve flips the status to PUBLISHED optimistically', () => {
    configure();
    page.approve();
    expect(approveSpy).toHaveBeenCalledWith('review-1');
    expect(page.review()?.status).toBe('PUBLISHED');
    expect(page.saved()).toBe(true);
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

  it('formats ApiNotFoundError with the review-not-found message', () => {
    approveSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.approve();
    expect(page.error()).toBe('Review not found.');
  });

  it('is axe-clean with the review + actions surface', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  it('canDelete is false without reviews:delete permission', () => {
    configure(true, false);
    expect(page.canDelete()).toBe(false);
  });

  it('canDelete is true with reviews:delete permission', () => {
    configure(true, true);
    expect(page.canDelete()).toBe(true);
  });

  it('edit() opens the edit dialog and PATCHes the review on save', async () => {
    dialogOpenSpy = jest.fn(() =>
      makeDialogRef({
        rating: 5,
        title: 'Curated copy',
        body: 'Edited body',
        status: 'PUBLISHED',
      }),
    );
    configure();
    await page.edit();
    expect(dialogOpenSpy).toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith('review-1', {
      rating: 5,
      title: 'Curated copy',
      body: 'Edited body',
      status: 'PUBLISHED',
    });
    expect(page.bodyText(page.review()!)).toBe('Edited body');
    expect(page.review()?.status).toBe('PUBLISHED');
  });

  it('edit() bails out when the dialog is dismissed', async () => {
    dialogOpenSpy = jest.fn(() => makeDialogRef(null));
    configure();
    await page.edit();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('remove() opens the confirm dialog and DELETEs on confirm', async () => {
    dialogOpenSpy = jest.fn(() => makeDialogRef(true));
    configure(true, true);
    await page.remove();
    expect(dialogOpenSpy).toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith('review-1');
  });

  it('remove() does not call DELETE when the confirm is cancelled', async () => {
    dialogOpenSpy = jest.fn(() => makeDialogRef(false));
    configure(true, true);
    await page.remove();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
