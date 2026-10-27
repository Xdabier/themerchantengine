import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { LocaleService } from '../../locale.service';
import { LOCALE_INTL_TAG } from '../../../i18n/types';
import { RatingComponent } from '../../ui/rating.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { ReviewFormComponent, type ReviewFormSubmit } from './review-form.component';
import type { Review } from '@storefront-types';

export interface ReviewsSummaryRow {
  id: string;
  /**
   * The locale the review was written in, when known.
   *
   * Customer text is stored single-locale and nothing translates it, so a
   * review written in French is shown in French on the English page. The
   * `lang` attribute is what lets a screen reader pronounce it correctly, and
   * `dir="auto"` keeps a right-to-left body from breaking the layout.
   */
  locale?: string | null;
  rating: number;
  title?: string | null;
  body: string;
  authorName: string;
  createdAt: string;
  helpfulCount?: number;
  votedHelpful?: boolean;
  ownReview?: boolean;
  status?: 'PENDING' | 'PUBLISHED' | 'HIDDEN';
}

export interface ReviewsSummaryInput {
  averageRating: number;
  total: number;
  histogram?: Partial<Record<'1' | '2' | '3' | '4' | '5', number>>;
  firstReviews: ReviewsSummaryRow[];
}

@Component({
  selector: 'product-reviews-summary',
  standalone: true,
  imports: [NgTemplateOutlet, RatingComponent, EmptyStateComponent, ReviewFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="reviews"
      class="reviews"
      [attr.aria-labelledby]="titleId"
      data-testid="product-reviews-summary"
    >
      <h2 [id]="titleId" class="title">{{ strings().product.reviews.title }}</h2>

      @if (ownReview(); as own) {
        <div class="own-review" data-testid="product-own-review">
          <h3 class="own-title">{{ strings().product.reviews.yourReview }}</h3>
          <ol class="list">
            <li class="review">
              <ng-container
                [ngTemplateOutlet]="reviewRow"
                [ngTemplateOutletContext]="{ $implicit: own }"
              ></ng-container>
            </li>
          </ol>
        </div>
      }

      @if (input().total > 0) {
        <div class="header">
          <app-rating [value]="input().averageRating" [count]="input().total" />
          <p class="summary">{{ summaryText() }}</p>
        </div>

        <ul class="histogram" role="list">
          @for (row of histogramRows(); track row.star) {
            <li class="bar-row">
              <span class="bar-label" aria-hidden="true">{{ row.star }}★</span>
              <span class="sr-only">{{ rowStarsLabel(row.star) }}</span>
              <span class="bar" aria-hidden="true">
                <span class="fill" [style.inline-size]="row.percent + '%'"></span>
              </span>
              <span class="bar-count">{{ row.count }}</span>
            </li>
          }
        </ul>

        @if (input().firstReviews.length > 0) {
          <ol class="list" data-testid="product-reviews-list">
            @for (r of input().firstReviews; track r.id) {
              <li class="review">
                <ng-container
                  [ngTemplateOutlet]="reviewRow"
                  [ngTemplateOutletContext]="{ $implicit: r }"
                ></ng-container>
              </li>
            }
          </ol>
          @if (hasMore()) {
            <button
              type="button"
              class="show-more"
              (click)="loadMore.emit()"
              data-testid="product-reviews-show-more"
            >
              {{ strings().product.reviews.showMore }}
            </button>
          }
        }
      } @else if (!ownReview()) {
        <app-empty-state [heading]="strings().product.reviews.empty" />
      }

      <ng-template #reviewRow let-r>
        @if (editingReviewId() === r.id && editTarget(); as target) {
          <product-review-form
            mode="edit"
            [initialReview]="target"
            [saving]="editSaving()"
            [externalError]="editError()"
            (submitted)="onEditSubmit($event)"
            (cancelled)="onEditCancel()"
          />
        } @else {
          <div class="meta">
            <app-rating [value]="r.rating" [count]="1" />
            <span class="author">{{ r.authorName }}</span>
            <time [attr.datetime]="r.createdAt" class="time">{{ formatDate(r.createdAt) }}</time>
            @if (r.status === 'PENDING') {
              <span class="badge-pending" [attr.data-testid]="'product-review-pending-' + r.id">
                {{ strings().product.reviews.pendingBadge }}
              </span>
            }
          </div>
          @if (r.title) {
            <p class="review-title" dir="auto" [attr.lang]="r.locale || null">{{ r.title }}</p>
          }
          <p class="body" dir="auto" [attr.lang]="r.locale || null">{{ r.body }}</p>
          <div class="actions">
            @if (authed() && !r.ownReview) {
              <button
                type="button"
                class="helpful-btn"
                [class.pressed]="r.votedHelpful"
                [attr.aria-pressed]="r.votedHelpful ? 'true' : 'false'"
                [attr.aria-label]="
                  r.votedHelpful
                    ? strings().product.reviews.helpfulPressed
                    : strings().product.reviews.helpful
                "
                [attr.data-testid]="'product-review-helpful-' + r.id"
                (click)="onHelpfulClick(r)"
              >
                <span aria-hidden="true">👍</span>
                <span>{{ helpfulCountLabel(r.helpfulCount ?? 0) }}</span>
              </button>
            } @else if (!authed() && (r.helpfulCount ?? 0) > 0) {
              <span
                class="helpful-readonly"
                [attr.data-testid]="'product-review-helpful-readonly-' + r.id"
              >
                {{ helpfulCountLabel(r.helpfulCount ?? 0) }}
              </span>
            }
            @if (r.ownReview) {
              <button
                type="button"
                class="row-action"
                [attr.aria-label]="strings().product.reviews.edit"
                [attr.data-testid]="'product-review-edit-' + r.id"
                (click)="onEditClick(r)"
              >
                {{ strings().product.reviews.edit }}
              </button>
              <button
                type="button"
                class="row-action danger"
                [attr.aria-label]="strings().product.reviews.delete"
                [attr.data-testid]="'product-review-delete-' + r.id"
                (click)="onDeleteClick(r)"
              >
                {{ strings().product.reviews.delete }}
              </button>
            }
          </div>
        }
      </ng-template>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .reviews {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .own-review {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-block-end: 1rem;
        border-block-end: 1px solid var(--brand-border);
      }
      .own-title {
        margin: 0;
        font-family: var(--brand-font-display);
        font-size: var(--brand-text-body);
        font-weight: 600;
        color: var(--brand-text);
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .header {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      .summary {
        margin: 0;
        font-size: var(--brand-text-body);
        color: var(--brand-text-muted);
      }
      .histogram {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .bar-row {
        display: grid;
        grid-template-columns: 32px 1fr 36px;
        align-items: center;
        gap: 0.5rem;
      }
      .bar-label {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .bar {
        block-size: 8px;
        background-color: var(--brand-surface-strong);
        border-radius: var(--brand-radius-full);
        overflow: hidden;
      }
      .fill {
        display: block;
        block-size: 100%;
        background-color: var(--brand-primary);
      }
      .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .bar-count {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
        text-align: end;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
      }
      .review {
        background-color: var(--brand-surface);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        padding-block: 0.875rem;
        padding-inline: 1rem;
      }
      .meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .author {
        font-size: var(--brand-text-body);
        color: var(--brand-text);
      }
      .time {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .review-title {
        margin-block: 0.25rem 0;
        font-weight: 600;
      }
      .body {
        margin-block: 0.375rem 0;
        font-size: var(--brand-text-body);
        line-height: 1.5;
      }
      .badge-pending {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
        border: 1px solid var(--brand-warning);
        padding-block: 0.125rem;
        padding-inline: 0.5rem;
      }
      .actions {
        margin-block-start: 0.625rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .helpful-btn,
      .row-action {
        background: transparent;
        border: 1px solid var(--brand-border);
        color: var(--brand-text);
        cursor: pointer;
        font: inherit;
        font-size: var(--brand-text-micro);
        padding-block: 0.5rem;
        padding-inline: 0.75rem;
        min-block-size: 44px;
        min-inline-size: 44px;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
      }
      .helpful-btn.pressed {
        border-color: var(--brand-primary);
        color: var(--brand-primary);
      }
      .row-action.danger {
        color: var(--brand-error);
      }
      .helpful-btn:focus-visible,
      .row-action:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .helpful-readonly {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .show-more {
        align-self: flex-start;
        appearance: none;
        border: 0;
        background: none;
        cursor: pointer;
        font: inherit;
        color: var(--brand-primary);
        font-weight: 500;
        min-block-size: 44px;
        padding-block: 0.625rem;
      }
      .show-more:hover,
      .show-more:focus-visible {
        text-decoration: underline;
      }
    `,
  ],
})
export class ReviewsSummaryComponent {
  readonly input = input.required<ReviewsSummaryInput>();
  readonly authed = input<boolean>(false);
  /**
   * The caller's own review, in any status, rendered in its own slot above the
   * aggregate and never counted into it. A pending review belongs to its author
   * alone: counting it produced the "0.0 out of 5, 1 reviews" header, and
   * leaving it out of the payload entirely made it vanish on reload.
   */
  readonly ownReview = input<ReviewsSummaryRow | null>(null);
  readonly editingReviewId = input<string | null>(null);
  readonly editTarget = input<Review | null>(null);
  readonly editSaving = input<boolean>(false);
  readonly editError = input<string | null>(null);

  readonly helpfulToggle = output<{ reviewId: string; nextVoted: boolean }>();
  readonly editClicked = output<{ reviewId: string }>();
  readonly editSubmitted = output<ReviewFormSubmit>();
  readonly editCancelled = output<void>();
  readonly deleteClicked = output<{ reviewId: string }>();
  readonly loadMore = output<void>();

  /**
   * Whether published reviews remain beyond the ones on screen.
   *
   * This replaced a `href="#reviews"` anchor, which resolved against
   * `<base href="/">` and sent the reader to the home page; corrected, it
   * would have pointed at the section it already sat in, and only the first
   * few rows were ever fetched.
   */
  protected readonly hasMore = computed(
    () => this.input().firstReviews.length < this.input().total,
  );

  protected readonly titleId = `product-reviews-${++reviewsSummaryId}`;

  private readonly localeService = inject(LocaleService);
  protected readonly strings = computed(() => this.localeService.strings());

  protected readonly summaryText = computed(() => {
    const t = this.strings().product.reviews.summary;
    return t
      .replace('{rating}', this.input().averageRating.toFixed(1))
      .replace('{count}', String(this.input().total));
  });

  protected readonly histogramRows = computed(() => {
    const total = this.input().total;
    const hist = this.input().histogram ?? {};
    return ([5, 4, 3, 2, 1] as const).map((star) => {
      const count = hist[String(star) as '1' | '2' | '3' | '4' | '5'] ?? 0;
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      return { star, count, percent };
    });
  });

  protected rowStarsLabel(star: number): string {
    return this.strings().product.reviews.starsLabel.replace('{rating}', String(star));
  }

  protected helpfulCountLabel(count: number): string {
    return this.strings().product.reviews.helpfulCount.replace('{count}', String(count));
  }

  protected formatDate(iso: string): string {
    const locale = LOCALE_INTL_TAG[this.localeService.locale()];
    try {
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  protected onHelpfulClick(row: ReviewsSummaryRow): void {
    this.helpfulToggle.emit({ reviewId: row.id, nextVoted: !row.votedHelpful });
  }

  protected onEditClick(row: ReviewsSummaryRow): void {
    this.editClicked.emit({ reviewId: row.id });
  }

  protected onDeleteClick(row: ReviewsSummaryRow): void {
    this.deleteClicked.emit({ reviewId: row.id });
  }

  protected onEditSubmit(event: ReviewFormSubmit): void {
    this.editSubmitted.emit(event);
  }

  protected onEditCancel(): void {
    this.editCancelled.emit();
  }
}

let reviewsSummaryId = 0;
