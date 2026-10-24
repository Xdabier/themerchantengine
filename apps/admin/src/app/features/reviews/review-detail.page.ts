import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, SkeletonComponent, openConfirmDialog } from '@admin-ui';
import { AuthStore } from '../../core/stores/auth.store';
import { ReviewsService, type Review } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, pickTranslation } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { openReviewModerateDialog } from './review-moderate-dialog.component';
import { openReviewEditDialog } from './review-edit-dialog.component';
import {
  canApprove,
  canReject,
  renderStars,
  reviewAuthorLabel,
  reviewStatusTone,
} from './reviews.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/reviews/:id` — single review detail + moderation actions.
 *
 * Approve calls the API directly (no confirm — the action is reversible by
 * rejecting). Reject opens a shared `ReviewModerateDialogComponent` to
 * collect an optional reason before PATCHing.
 */
@Component({
  selector: 'app-review-detail-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent, AdminDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="review-detail-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/reviews" class="hover:underline">Reviews</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">Detail</span>
      </nav>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="review-detail-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>
      <span
        class="sr-only"
        role="status"
        data-testid="review-saved"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ saved() ? 'Saved' : '' }}
      </span>
      @if (loading()) {
        <div class="flex flex-col gap-3">
          <app-skeleton height="2.5rem" />
          <app-skeleton height="1rem" />
          <app-skeleton height="6rem" />
        </div>
      } @else if (review(); as r) {
        <header class="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1
              class="text-3xl md:text-4xl font-bold tracking-tight"
              [attr.aria-label]="r.rating + ' out of 5'"
            >
              <span class="tabular-nums" data-testid="review-rating">{{ stars(r.rating) }}</span>
              @if (titleText(r)) {
                <span class="ml-3 text-xl text-ink-muted">{{ titleText(r) }}</span>
              }
            </h1>
            <p class="mt-2 text-sm text-ink-muted">
              by {{ authorLabel(r) }} ·
              <span class="tabular tabular-nums">{{ r.createdAt | adminDate }}</span>
            </p>
          </div>
          <app-badge [tone]="statusTone(r.status)" [ariaLabel]="'Review status: ' + r.status">
            <span data-testid="review-status">{{ r.status }}</span>
          </app-badge>
        </header>

        <section
          class="border border-line bg-surface p-6 flex flex-col gap-4"
          aria-labelledby="review-body-heading"
        >
          <h2 id="review-body-heading" class="text-xs tracking-widest uppercase text-ink-muted">
            Body
          </h2>
          <p class="text-sm text-ink whitespace-pre-line" data-testid="review-body">
            {{ bodyText(r) || '—' }}
          </p>
          <dl class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div>
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Product</dt>
              <dd class="mt-1 text-sm">
                <a
                  [routerLink]="['/products', r.productId]"
                  class="text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  data-testid="review-product-link"
                >
                  {{ r.product?.slug ?? r.productId }}
                </a>
              </dd>
            </div>
            <div>
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Helpful</dt>
              <dd class="mt-1 text-sm text-ink tabular-nums">
                {{ r.helpfulCount ?? 0 }}
              </dd>
            </div>
            <div>
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Verified</dt>
              <dd class="mt-1 text-sm text-ink">
                {{ r.verifiedPurchase ? 'Yes' : 'No' }}
              </dd>
            </div>
          </dl>
        </section>

        @if (canManage()) {
          <section
            class="border border-line bg-surface p-6 flex items-center justify-between gap-4"
            data-testid="review-actions"
            aria-labelledby="review-actions-heading"
          >
            <h2
              id="review-actions-heading"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              Actions
            </h2>
            <div class="flex items-center gap-3">
              <span
                class="text-xs text-ink-muted tabular-nums"
                data-testid="review-saved-visible"
                aria-hidden="true"
              >
                {{ saved() ? 'Saved' : '' }}
              </span>
              <app-button
                data-testid="review-approve"
                variant="primary"
                [disabled]="!canApproveNow() || !!busy()"
                [loading]="busy() === 'approve'"
                (clicked)="approve()"
              >
                Approve
              </app-button>
              <app-button
                data-testid="review-reject"
                variant="destructive"
                [disabled]="!canRejectNow() || !!busy()"
                [loading]="busy() === 'reject'"
                (clicked)="reject()"
              >
                Reject
              </app-button>
              <app-button
                data-testid="review-edit"
                variant="ghost"
                [disabled]="!!busy()"
                [loading]="busy() === 'edit'"
                (clicked)="edit()"
              >
                Edit
              </app-button>
              @if (canDelete()) {
                <app-button
                  data-testid="review-delete"
                  variant="destructive"
                  [disabled]="!!busy()"
                  [loading]="busy() === 'delete'"
                  (clicked)="remove()"
                >
                  Delete
                </app-button>
              }
            </div>
          </section>
        }
      }
    </section>
  `,
})
export class ReviewDetailPage implements OnInit, OnDestroy {
  private readonly reviewsService = inject(ReviewsService);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(Dialog);
  private readonly destroy$ = new Subject<void>();

  readonly review = signal<Review | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<'approve' | 'reject' | 'edit' | 'delete' | null>(null);
  readonly saved = signal(false);

  readonly canManage = computed(() => this.auth.hasPermission('reviews:update'));
  readonly canDelete = computed(() => this.auth.hasPermission('reviews:delete'));
  readonly canApproveNow = computed(() => canApprove(this.review()?.status));
  readonly canRejectNow = computed(() => canReject(this.review()?.status));

  protected readonly stars = renderStars;
  protected readonly statusTone = reviewStatusTone;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  authorLabel(r: Review): string {
    return reviewAuthorLabel(r.user ?? null, r.userId ?? null);
  }

  /** Resolve the Translatable `title` to the active locale — '' when absent. */
  titleText(r: Review): string {
    return pickTranslation(r.title, this.auth.locale(), '', this.storeSettings.defaultLocale());
  }

  /** Resolve the Translatable `body` to the active locale for display. */
  bodyText(r: Review): string {
    return pickTranslation(r.body, this.auth.locale(), '', this.storeSettings.defaultLocale());
  }

  approve(): void {
    const current = this.review();
    if (!current || this.busy()) return;
    this.busy.set('approve');
    this.reviewsService
      .approveReview(current.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => this.applyResult(updated),
        error: (err: unknown) => this.failAction(err),
      });
  }

  async reject(): Promise<void> {
    const current = this.review();
    if (!current || this.busy()) return;
    const result = await openReviewModerateDialog(this.dialog, { subject: 'review' });
    if (!result) return;
    this.busy.set('reject');
    this.reviewsService
      .rejectReview(current.id, result)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => this.applyResult(updated),
        error: (err: unknown) => this.failAction(err),
      });
  }

  async edit(): Promise<void> {
    const current = this.review();
    if (!current || this.busy()) return;
    const result = await openReviewEditDialog(this.dialog, {
      reviewId: current.id,
      rating: current.rating,
      // Resolve Translatable → active-locale string before prefilling the
      // scalar edit form; '' collapses to null so empty fields stay empty.
      title: this.titleText(current) || null,
      body: this.bodyText(current) || null,
      status: current.status,
    });
    if (!result) return;
    this.busy.set('edit');
    this.reviewsService
      .updateReview(current.id, result)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => this.applyResult(updated),
        error: (err: unknown) => this.failAction(err),
      });
  }

  async remove(): Promise<void> {
    const current = this.review();
    if (!current || this.busy()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this review?',
      body: 'The review will be permanently removed and cannot be restored.',
      confirmLabel: 'Delete review',
      cancelLabel: 'Cancel',
      tone: 'destructive',
    });
    if (!ok) return;
    this.busy.set('delete');
    this.reviewsService
      .deleteReview(current.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.router.navigate(['/reviews']);
        },
        error: (err: unknown) => this.failAction(err),
      });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    // There is no GET-one endpoint; probe each status slice in order (PENDING,
    // PUBLISHED, HIDDEN) so large catalogs don't push the target review out of
    // the default pageSize=100 window.
    const statuses = ['PENDING', 'PUBLISHED', 'HIDDEN'] as const;
    let idx = 0;
    const tryNext = () => {
      if (idx >= statuses.length) {
        this.error.set('Review not found.');
        this.loading.set(false);
        return;
      }
      const status = statuses[idx++];
      this.reviewsService
        .listReviews({ pageSize: 100, status })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            const match = res.data.find((r) => r.id === id) ?? null;
            if (!match) {
              tryNext();
              return;
            }
            this.review.set(match);
            this.loading.set(false);
          },
          error: (err: unknown) => {
            this.loading.set(false);
            this.error.set(this.formatError(err));
          },
        });
    };
    tryNext();
  }

  private applyResult(updated: Review): void {
    this.review.update((prev) => (prev ? { ...prev, ...updated } : updated));
    this.busy.set(null);
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 3000);
  }

  private failAction(err: unknown): void {
    this.busy.set(null);
    this.error.set(this.formatError(err));
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to moderate this review.';
    if (err instanceof ApiNotFoundError) return 'Review not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save the change. Please retry.';
  }
}
