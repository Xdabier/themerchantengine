import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BadgeComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import {
  ReviewsService,
  reviewStatusSchema,
  type ListReviewsQuery,
  type Review,
  type ReviewStatus,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, pickTranslation } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { renderStars, reviewAuthorLabel, reviewStatusTone } from './reviews.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/reviews` — paginated moderation queue for product reviews.
 *
 * URL is the source of truth for `page`, `pageSize`, `status`, and `rating`
 * so the view is bookmarkable. Default status chip is PENDING because
 * moderators land here to triage new submissions.
 */
@Component({
  selector: 'app-reviews-list-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, SkeletonComponent, AdminDatePipe, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="reviews-list-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Moderation</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Reviews</h1>
        <p class="mt-3 text-sm text-ink-muted">
          Triage customer reviews — approve, reject, or hide submissions.
        </p>
      </header>

      <div
        class="flex items-center gap-3 flex-wrap"
        role="group"
        aria-label="Filter reviews by status"
      >
        <span class="text-xs tracking-widest uppercase text-ink-muted">Status</span>
        @for (opt of statusOptions; track opt.value) {
          <button
            type="button"
            class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="status() === opt.value"
            [class.text-ink]="status() === opt.value"
            [class.border-line]="status() !== opt.value"
            [class.text-ink-muted]="status() !== opt.value"
            [attr.aria-pressed]="status() === opt.value"
            [attr.data-testid]="'reviews-filter-chip-' + (opt.value ?? 'ALL')"
            (click)="setStatus(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="reviews-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Review moderation queue
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Rating
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Review
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Product
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Author
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Submitted
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of [0, 1, 2, 3, 4, 5]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td colspan="6" class="px-4 py-16 text-center text-ink-muted text-sm">
                    No reviews match the current filter.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'review-row-' + item.id"
                  >
                    <td
                      class="px-4 py-3 text-sm text-ink tabular-nums"
                      [attr.aria-label]="item.rating + ' out of 5'"
                    >
                      {{ stars(item.rating) }}
                    </td>
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/reviews', item.id]"
                        class="text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ titleText(item) || truncate(bodyText(item)) }}
                      </a>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted">
                      {{ item.product?.slug ?? item.productId }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted">
                      {{ authorLabel(item) }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.createdAt | adminDate }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(item.status)"
                        [ariaLabel]="'Review status: ' + item.status"
                      >
                        {{ item.status }}
                      </app-badge>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>

      <app-pagination
        [page]="page()"
        [pageSize]="pageSize()"
        [total]="total()"
        [loading]="loading()"
        testIdPrefix="reviews"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class ReviewsListPage implements OnInit, OnDestroy {
  private readonly reviewsService = inject(ReviewsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2, 3, 4, 5, 6, 7];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Review[]>([]);
  readonly total = signal(0);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly status = computed<ReviewStatus | null>(() => {
    const raw = this.queryParams()['status'];
    const parsed = reviewStatusSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly statusOptions = [
    { value: 'PENDING' as const, label: 'Pending' },
    { value: 'PUBLISHED' as const, label: 'Published' },
    { value: 'HIDDEN' as const, label: 'Hidden' },
    { value: null, label: 'All' },
  ];

  protected readonly stars = renderStars;
  protected readonly statusTone = reviewStatusTone;

  ngOnInit(): void {
    // Default-route case: no query param at all → redirect to PENDING before
    // fetching so the list never renders an unfiltered result set.
    const needsRedirect = !this.queryParams()['status'];
    if (needsRedirect) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { status: 'PENDING' },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      // When a redirect is pending, skip the bare-URL emission — the
      // navigation above will immediately fire a second emission with
      // status=PENDING, which is the one we want to fetch.
      if (needsRedirect && !params['status']) return;
      this.fetch();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setStatus(status: ReviewStatus | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status, page: null },
      queryParamsHandling: 'merge',
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  authorLabel(item: Review): string {
    return reviewAuthorLabel(item.user ?? null, item.userId ?? null);
  }

  /** Resolve the Translatable `title` to the active locale — '' when absent. */
  titleText(item: Review): string {
    return pickTranslation(item.title, this.auth.locale(), '', this.storeSettings.defaultLocale());
  }

  /** Resolve the Translatable `body` to the active locale for display. */
  bodyText(item: Review): string {
    return pickTranslation(item.body, this.auth.locale(), '', this.storeSettings.defaultLocale());
  }

  truncate(text: string | null | undefined): string {
    if (!text) return '—';
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }

  private fetch(): void {
    const query: ListReviewsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    const status = this.status();
    if (status) query.status = status;

    this.loading.set(true);
    this.error.set(null);
    this.reviewsService
      .listReviews(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view reviews.';
    if (err instanceof ApiNotFoundError) return 'Reviews not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load reviews. Please retry.';
  }
}
