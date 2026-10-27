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
import { AnalyticsService, type RevenueAnalyticsResponse } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AnalyticsDateRangeComponent, type DateRangeValue } from './date-range.component';
import { formatCount } from './analytics.utils';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

/**
 * `/analytics/revenue` — revenue metrics per screen-inventory §1.4.
 * Eight metric tiles, date-range picker, brutalist dl.
 */
@Component({
  selector: 'app-analytics-revenue-page',
  standalone: true,
  imports: [AnalyticsDateRangeComponent, SkeletonComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="analytics-revenue-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Analytics</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Revenue</h1>
        </div>
      </header>

      <app-analytics-date-range (rangeChanged)="reload($event)" />

      <div
        class="min-h-[2rem] max-w-sm"
        data-testid="analytics-revenue-error"
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
        <dl
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          data-testid="analytics-revenue-metrics"
          aria-label="Revenue metrics"
        >
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Gross revenue</dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">
              {{ m.grossRevenue | money }}
            </dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Net revenue</dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">{{ m.netRevenue | money }}</dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Orders</dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">{{ formatCount(m.orderCount) }}</dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">AOV</dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">{{ m.aov | money }}</dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Discounts</dt>
            <dd class="mt-2 text-xl font-bold tabular-nums">
              {{ m.totalDiscounts | money }}
            </dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Refunds</dt>
            <dd class="mt-2 text-xl font-bold tabular-nums">
              {{ m.totalRefunds | money }}
            </dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Unique sessions</dt>
            <dd class="mt-2 text-xl font-bold tabular-nums">{{ formatCount(m.uniqueSessions) }}</dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Revenue / visitor</dt>
            <dd class="mt-2 text-xl font-bold tabular-nums">
              {{ m.revenuePerVisitor | money }}
            </dd>
          </div>
        </dl>
      }
    </section>
  `,
})
export class AnalyticsRevenuePage implements OnInit, OnDestroy {
  private readonly service = inject(AnalyticsService);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly metrics = signal<RevenueAnalyticsResponse | null>(null);

  formatCount = formatCount;

  ngOnInit(): void {
    this.load({});
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  reload(range: DateRangeValue): void {
    this.load(range);
  }

  private load(range: DateRangeValue): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .revenue(range)
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
    if (err instanceof ApiNotFoundError) return 'Revenue analytics not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load revenue analytics.';
  }
}
