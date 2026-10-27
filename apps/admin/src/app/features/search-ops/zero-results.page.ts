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
import { PaginationComponent, SkeletonComponent } from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import {
  ANALYTICS_PERIODS,
  SearchAdminService,
  type AnalyticsPeriod,
  type ZeroResultQuery,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-zero-results-page',
  standalone: true,
  imports: [RouterLink, SkeletonComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="zero-results-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/search-ops" class="hover:underline">Search ops</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">Zero results</span>
      </nav>

      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Zero-result queries</h1>
          <p class="mt-3 text-sm text-ink-muted">
            Queries that returned no results in the selected window. Close catalogue gaps or adjust
            synonyms.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Analytics period"
          class="inline-flex border border-line"
          data-testid="zero-results-period"
          (keydown)="onPeriodKeydown($event)"
        >
          @for (p of periods; track p; let idx = $index) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="period() === p"
              [attr.tabindex]="period() === p ? 0 : -1"
              [attr.data-period-index]="idx"
              [attr.data-testid]="'zero-results-period-' + p"
              (click)="setPeriod(p)"
              class="min-h-[44px] px-5 py-2 text-sm tracking-widest uppercase font-medium focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [class.bg-surface-emphasis]="period() === p"
              [class.text-on-emphasis]="period() === p"
              [class.bg-surface]="period() !== p"
              [class.text-ink]="period() !== p"
              [class.hover:bg-surface-elevated]="period() !== p"
            >
              {{ p }} days
            </button>
          }
        </div>
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="zero-results-error"
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
              Zero-result queries over the last
              {{
                period()
              }}
              days
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Query
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 w-32"
                >
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of skeletonRows; track $index) {
                  <tr class="border-b border-line">
                    <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    colspan="2"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="zero-results-empty"
                  >
                    No zero-result queries in the last {{ period() }} days.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.query) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated"
                    [attr.data-testid]="'zero-row-' + item.query"
                  >
                    <td class="px-4 py-3 font-mono text-xs text-ink break-all">
                      {{ item.query }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.count }}
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
        testIdPrefix="zero-results"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class ZeroResultsPage implements OnInit, OnDestroy {
  private readonly search = inject(SearchAdminService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly periods = ANALYTICS_PERIODS;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly ZeroResultQuery[]>([]);
  readonly total = signal(0);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly period = computed<AnalyticsPeriod>(() => {
    const raw = Number(this.queryParams()['period']);
    return (ANALYTICS_PERIODS as readonly number[]).includes(raw) ? (raw as AnalyticsPeriod) : 30;
  });
  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setPeriod(p: AnalyticsPeriod): void {
    if (p === this.period()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { period: p, page: 1 },
      queryParamsHandling: 'merge',
    });
  }

  onPeriodKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const list = ANALYTICS_PERIODS;
    const currentIdx = list.indexOf(this.period());
    let nextIdx = currentIdx;
    if (event.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + list.length) % list.length;
    if (event.key === 'ArrowRight') nextIdx = (currentIdx + 1) % list.length;
    if (event.key === 'Home') nextIdx = 0;
    if (event.key === 'End') nextIdx = list.length - 1;
    const next = list[nextIdx];
    this.setPeriod(next);
    queueMicrotask(() => {
      const btn = document.querySelector<HTMLButtonElement>(`[data-period-index="${nextIdx}"]`);
      btn?.focus();
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

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.search
      .zeroResults({ period: this.period(), page: this.page(), pageSize: this.pageSize() })
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view analytics.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load zero-result queries. Please retry.';
  }
}
