import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { SkeletonComponent } from '@admin-ui';
import { AnalyticsService, type SearchAnalyticsResponse } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AnalyticsDateRangeComponent, type DateRangeValue } from './date-range.component';
import { formatCount, rangeLabel } from './analytics.utils';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/analytics/search` — search analytics per screen-inventory §1.6.
 * Total search count + top queries table.
 */
@Component({
  selector: 'app-analytics-search-page',
  standalone: true,
  imports: [AnalyticsDateRangeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="analytics-search-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Analytics</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Search</h1>
        </div>
      </header>

      <app-analytics-date-range (rangeChanged)="reload($event)" />

      @if (rangeEcho(); as label) {
        <p class="text-xs tabular text-ink-muted" data-testid="analytics-search-range">
          Showing {{ label }}
        </p>
      }

      <div
        class="min-h-[2rem] max-w-sm"
        data-testid="analytics-search-error"
        role="alert"
        aria-atomic="true"
      >
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <app-skeleton height="16rem" width="100%" />
      } @else if (metrics(); as m) {
        <div class="flex flex-col gap-6" data-testid="analytics-search-metrics">
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md" aria-label="Search metrics">
            <div class="border border-line bg-surface p-5">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Total searches</dt>
              <dd class="mt-2 text-3xl font-bold tabular-nums">
                {{ formatCount(m.totalSearches) }}
              </dd>
            </div>
            <div class="border border-line bg-surface p-5">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Top queries</dt>
              <dd class="mt-2 text-3xl font-bold tabular-nums">{{ m.topQueries.length }}</dd>
            </div>
          </dl>
          <div class="overflow-x-auto">
            @if (m.topQueries.length === 0) {
              <p class="text-sm text-ink" data-testid="analytics-search-empty">
                @if (rangeEcho(); as label) {
                  No searches between {{ label }}.
                } @else {
                  No searches recorded yet.
                }
              </p>
            } @else {
              <table class="w-full border border-line" aria-label="Top search queries">
                <thead>
                  <tr class="bg-surface border-b border-line">
                    <th
                      scope="col"
                      class="text-left px-4 py-3 text-xs tracking-widest uppercase text-ink-muted"
                    >
                      Query
                    </th>
                    <th
                      scope="col"
                      class="text-right px-4 py-3 text-xs tracking-widest uppercase text-ink-muted"
                    >
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (q of m.topQueries; track q.query) {
                    <tr class="border-b border-line">
                      <td class="px-4 py-3 text-sm text-ink">{{ q.query }}</td>
                      <td class="px-4 py-3 text-right tabular-nums">{{ q.count }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </div>
      }
    </section>
  `,
})
export class AnalyticsSearchPage implements OnInit, OnDestroy {
  private readonly service = inject(AnalyticsService);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  /**
   * The range the results actually cover. A plain method reads the store
   * signal on every pass (the zoneless rule), so a late settings hydration
   * re-renders the readback.
   */
  readonly appliedRange = signal<DateRangeValue>({});

  protected rangeEcho(): string | null {
    return rangeLabel(this.appliedRange(), this.storeSettings.timezone());
  }

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly metrics = signal<SearchAnalyticsResponse | null>(null);

  formatCount = formatCount;

  ngOnInit(): void {
    this.load({});
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  reload(range: DateRangeValue): void {
    this.appliedRange.set(range);
    this.load(range);
  }

  private load(range: DateRangeValue): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .search(range)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.metrics.set(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(this.formatError(err));
          this.loading.set(false);
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view analytics.';
    if (err instanceof ApiNotFoundError) return 'Search analytics not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load search analytics.';
  }
}
