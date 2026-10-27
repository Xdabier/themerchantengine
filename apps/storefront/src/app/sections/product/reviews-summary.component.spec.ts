import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { ReviewsSummaryComponent, type ReviewsSummaryInput } from './reviews-summary.component';
import type { Review } from '@storefront-types';

const baseInput: ReviewsSummaryInput = {
  averageRating: 4.6,
  total: 23,
  histogram: { '5': 18, '4': 3, '3': 1, '2': 1, '1': 0 },
  firstReviews: [
    {
      id: 'r1',
      rating: 5,
      title: 'Excellent',
      body: 'Best earbuds ever.',
      authorName: 'Ahmad',
      createdAt: '2026-04-01T00:00:00Z',
    },
    {
      id: 'r2',
      rating: 4,
      body: 'Solid',
      authorName: 'Sara',
      createdAt: '2026-04-02T00:00:00Z',
    },
  ],
};

describe('ReviewsSummaryComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders the rating header + summary text when reviews exist', async () => {
    const fixture = await renderComponent(ReviewsSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('app-rating')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.summary')?.textContent).toContain('23');
  });

  it('renders 5 histogram rows', async () => {
    const fixture = await renderComponent(ReviewsSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    const rows = fixture.nativeElement.querySelectorAll('.bar-row');
    expect(rows.length).toBe(5);
  });

  it('renders the first reviews list with title + body + author', async () => {
    const fixture = await renderComponent(ReviewsSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    const reviews = fixture.nativeElement.querySelectorAll(
      '[data-testid="product-reviews-list"] .review',
    );
    expect(reviews.length).toBe(2);
    expect(reviews[0].querySelector('.review-title')?.textContent).toBe('Excellent');
  });

  it('renders the empty state when total is 0', async () => {
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      { input: { ...baseInput, total: 0, firstReviews: [] } },
      [provideRouter([]), LocaleService],
    );
    expect(fixture.nativeElement.querySelector('app-empty-state')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.histogram')).toBeNull();
  });

  it('renders the your-review slot above the aggregate, with no header, for a lone pending review', async () => {
    const ownReview = {
      id: 'own-1',
      rating: 4,
      title: 'Mine',
      body: 'Waiting on moderation.',
      authorName: 'Self',
      createdAt: '2026-04-05T00:00:00Z',
      helpfulCount: 0,
      ownReview: true,
      status: 'PENDING' as const,
    };
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      {
        input: { ...baseInput, total: 0, averageRating: 0, firstReviews: [] },
        authed: true,
        ownReview,
      },
      [provideRouter([]), LocaleService],
    );
    const root = fixture.nativeElement as HTMLElement;

    const slot = root.querySelector('[data-testid="product-own-review"]');
    expect(slot).not.toBeNull();
    // The pending review is the author's alone: it must never be counted, so
    // no "0.0 out of 5, 1 reviews" header and no histogram.
    expect(root.querySelector('.header')).toBeNull();
    expect(root.querySelector('.histogram')).toBeNull();
    // A visitor with their own review is not looking at an empty section.
    expect(root.querySelector('app-empty-state')).toBeNull();
    expect(slot?.querySelector('[data-testid="product-review-pending-own-1"]')).not.toBeNull();
    expect(slot?.querySelector('[data-testid="product-review-edit-own-1"]')).not.toBeNull();
    expect(slot?.querySelector('[data-testid="product-review-delete-own-1"]')).not.toBeNull();
  });

  it('keeps the your-review slot alongside a published aggregate', async () => {
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      {
        input: baseInput,
        authed: true,
        ownReview: {
          id: 'own-1',
          rating: 4,
          body: 'Mine',
          authorName: 'Self',
          createdAt: '2026-04-05T00:00:00Z',
          helpfulCount: 0,
          ownReview: true,
          status: 'PUBLISHED' as const,
        },
      },
      [provideRouter([]), LocaleService],
    );
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="product-own-review"]')).not.toBeNull();
    expect(root.querySelector('.header')).not.toBeNull();
    expect(root.querySelector('.summary')?.textContent).toContain('23');
  });

  it('renders no your-review slot when the caller has no review', async () => {
    const fixture = await renderComponent(ReviewsSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="product-own-review"]'),
    ).toBeNull();
  });

  it('offers show-more while published rows remain, and no dead anchor', async () => {
    const fixture = await renderComponent(ReviewsSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    const root = fixture.nativeElement as HTMLElement;
    // `href="#reviews"` resolved against <base href="/"> and sent the reader
    // to the home page, and even corrected it pointed at the section it sat in.
    expect(root.querySelector('.view-all')).toBeNull();
    expect(root.querySelector('[data-testid="product-reviews-show-more"]')).not.toBeNull();
  });

  it('hides show-more once every published review is on screen', async () => {
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      { input: { ...baseInput, total: baseInput.firstReviews.length } },
      [provideRouter([]), LocaleService],
    );
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="product-reviews-show-more"]',
      ),
    ).toBeNull();
  });

  it('emits loadMore when show-more is clicked', async () => {
    const fixture = await renderComponent(ReviewsSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    let emitted = 0;
    fixture.componentInstance.loadMore.subscribe(() => (emitted += 1));
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="product-reviews-show-more"]',
      ) as HTMLButtonElement
    ).click();
    expect(emitted).toBe(1);
  });

  it('passes axe with sectioned + labelled content', async () => {
    const fixture = await renderComponent(ReviewsSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement);
  });

  it('hides the helpful button for anonymous visitors', async () => {
    const inputWithCounts: ReviewsSummaryInput = {
      ...baseInput,
      firstReviews: [
        { ...baseInput.firstReviews[0], helpfulCount: 3, votedHelpful: false, ownReview: false },
      ],
    };
    const fixture = await renderComponent(ReviewsSummaryComponent, { input: inputWithCounts }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-review-helpful-r1"]'),
    ).toBeNull();
  });

  it('shows the helpful button + aria-pressed=false for authed peer rows', async () => {
    const inputWithCounts: ReviewsSummaryInput = {
      ...baseInput,
      firstReviews: [
        { ...baseInput.firstReviews[0], helpfulCount: 3, votedHelpful: false, ownReview: false },
      ],
    };
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      { input: inputWithCounts, authed: true },
      [provideRouter([]), LocaleService],
    );
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="product-review-helpful-r1"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('emits helpfulToggle with nextVoted=true when an unvoted row is clicked', async () => {
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      {
        input: {
          ...baseInput,
          firstReviews: [
            {
              ...baseInput.firstReviews[0],
              helpfulCount: 1,
              votedHelpful: false,
              ownReview: false,
            },
          ],
        },
        authed: true,
      },
      [provideRouter([]), LocaleService],
    );
    const spy = vi.fn();
    fixture.componentInstance.helpfulToggle.subscribe(spy);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="product-review-helpful-r1"]',
      ) as HTMLButtonElement
    ).click();
    expect(spy).toHaveBeenCalledWith({ reviewId: 'r1', nextVoted: true });
  });

  it('renders edit + delete actions only on own rows', async () => {
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      {
        input: {
          ...baseInput,
          firstReviews: [
            { ...baseInput.firstReviews[0], ownReview: true },
            { ...baseInput.firstReviews[1], ownReview: false },
          ],
        },
        authed: true,
      },
      [provideRouter([]), LocaleService],
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-review-edit-r1"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-review-edit-r2"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-review-delete-r1"]'),
    ).not.toBeNull();
  });

  it('emits editClicked when the edit action is clicked', async () => {
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      {
        input: {
          ...baseInput,
          firstReviews: [{ ...baseInput.firstReviews[0], ownReview: true }],
        },
        authed: true,
      },
      [provideRouter([]), LocaleService],
    );
    const spy = vi.fn();
    fixture.componentInstance.editClicked.subscribe(spy);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="product-review-edit-r1"]',
      ) as HTMLButtonElement
    ).click();
    expect(spy).toHaveBeenCalledWith({ reviewId: 'r1' });
  });

  it('renders the inline edit form when editingReviewId matches a row', async () => {
    const target: Review = {
      id: 'r1',
      productId: 'p',
      userId: 'u-self',
      rating: 5,
      title: 'Excellent',
      body: 'Best earbuds ever.',
      helpfulCount: 0,
      status: 'PUBLISHED',
      createdAt: '2026-04-01T00:00:00Z',
    };
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      {
        input: {
          ...baseInput,
          firstReviews: [{ ...baseInput.firstReviews[0], ownReview: true }],
        },
        authed: true,
        editingReviewId: 'r1',
        editTarget: target,
      },
      [provideRouter([]), LocaleService],
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-review-form-r1"]'),
    ).not.toBeNull();
  });

  it('renders the pending badge for rows in PENDING status', async () => {
    const fixture = await renderComponent(
      ReviewsSummaryComponent,
      {
        input: {
          ...baseInput,
          firstReviews: [
            { ...baseInput.firstReviews[0], ownReview: true, status: 'PENDING' as const },
          ],
        },
        authed: true,
      },
      [provideRouter([]), LocaleService],
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-review-pending-r1"]'),
    ).not.toBeNull();
  });
});
