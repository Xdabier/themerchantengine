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
import { AnalyticsService, type CustomerAnalyticsResponse } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AnalyticsDateRangeComponent, type DateRangeValue } from './date-range.component';
import { formatCount, formatPercent } from './analytics.utils';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

/**
 * `/analytics/customers` — customer metrics per screen-inventory §1.5.
 */
@Component({
  selector: 'app-analytics-customers-page',
  standalone: true,
  imports: [AnalyticsDateRangeComponent, SkeletonComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="analytics-customers-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Analytics</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Customers</h1>
        </div>
      </header>

      <app-analytics-date-range (rangeChanged)="reload($event)" />

      <div
        class="min-h-[2rem] max-w-sm"
        data-testid="analytics-customers-error"
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
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"
          data-testid="analytics-customers-metrics"
          aria-label="Customer metrics"
        >
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Total customers</dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">
              {{ formatCount(m.totalCustomers) }}
            </dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">New</dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">{{ formatCount(m.newCustomers) }}</dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Returning</dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">
              {{ formatCount(m.returningCustomers) }}
            </dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Retention rate</dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">
              {{ formatPercent(m.retentionRate) }}
            </dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">
              Avg. revenue / customer
            </dt>
            <dd class="mt-2 text-3xl font-bold tabular-nums">
              {{ m.avgCustomerRevenue | money }}
            </dd>
          </div>
        </dl>
      }
    </section>
  `,
})
export class AnalyticsCustomersPage implements OnInit, OnDestroy {
  private readonly service = inject(AnalyticsService);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly metrics = signal<CustomerAnalyticsResponse | null>(null);

  formatCount = formatCount;
  formatPercent = formatPercent;

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
      .customers(range)
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
    if (err instanceof ApiNotFoundError) return 'Customer analytics not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load customer analytics.';
  }
}
