import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { KpiCardComponent } from '@admin-ui';
import { AnalyticsService, type DashboardSummary } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { formatCount, formatPercent } from './analytics.utils';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

interface HubTile {
  readonly slug: string;
  readonly label: string;
  readonly caption: string;
  readonly permission?: string;
}

const TILES: readonly HubTile[] = [
  { slug: 'funnel', label: 'Conversion funnel', caption: 'Event drop-off per stage.' },
  { slug: 'products', label: 'Product performance', caption: 'Views, carts, purchases, revenue.' },
  { slug: 'revenue', label: 'Revenue', caption: 'Gross, net, AOV, RPV.' },
  { slug: 'customers', label: 'Customers', caption: 'New vs returning, retention, ARPC.' },
  { slug: 'search', label: 'Search', caption: 'Total searches and top queries.' },
  {
    slug: 'pixels',
    label: 'Tracking pixels',
    caption: 'Google, Meta, TikTok, Snap pixel IDs.',
    permission: 'analytics:manage',
  },
];

/**
 * `/analytics` — landing hub. KPI overview from `/analytics/dashboard`
 * plus six navigation tiles pointing at the sub-reports + pixels config.
 */
@Component({
  selector: 'app-analytics-hub-page',
  standalone: true,
  imports: [RouterLink, KpiCardComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="analytics-hub-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Overview</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Analytics</h1>
          <p class="mt-3 text-ink text-sm">Storefront performance and tracking configuration.</p>
        </div>
        <div
          class="min-h-[2rem] max-w-sm"
          data-testid="analytics-hub-error"
          role="alert"
          aria-atomic="true"
        >
          @if (error()) {
            <p class="border border-status-error text-ink p-3 text-xs">
              {{ error() }}
            </p>
          }
        </div>
      </header>

      <div
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        data-testid="analytics-kpi-grid"
      >
        <app-kpi-card
          label="Revenue · this week"
          [value]="summary()?.thisWeek?.revenue | money"
          [loading]="loading()"
          [sublabel]="'Gross, all currencies'"
          testId="analytics-kpi-revenue-week"
        />
        <app-kpi-card
          label="Orders · this week"
          [value]="formatCount(summary()?.thisWeek?.orders)"
          [loading]="loading()"
          [sublabel]="'Rolling 7 days'"
          testId="analytics-kpi-orders-week"
        />
        <app-kpi-card
          label="Sessions · this week"
          [value]="formatCount(summary()?.thisWeek?.uniqueSessions)"
          [loading]="loading()"
          [sublabel]="'Unique session IDs'"
          testId="analytics-kpi-sessions-week"
        />
        <app-kpi-card
          label="Conversion · this week"
          [value]="formatPercent(summary()?.thisWeek?.conversionRate)"
          [loading]="loading()"
          [sublabel]="'Orders ÷ sessions'"
          testId="analytics-kpi-conversion-week"
        />
      </div>

      <nav
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        aria-label="Analytics reports"
      >
        @for (t of tiles; track t.slug) {
          <a
            [routerLink]="['/analytics', t.slug]"
            [attr.data-testid]="'analytics-link-' + t.slug"
            class="border border-line bg-surface p-5 md:p-6 flex flex-col gap-2 hover:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            <p class="text-xs tracking-widest uppercase text-ink-muted">Report</p>
            <p class="text-lg font-bold text-ink tracking-tight">{{ t.label }}</p>
            <p class="text-xs text-ink">{{ t.caption }}</p>
          </a>
        }
      </nav>
    </section>
  `,
})
export class AnalyticsHubPage implements OnInit, OnDestroy {
  private readonly analytics = inject(AnalyticsService);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly summary = signal<DashboardSummary | null>(null);
  readonly error = signal<string | null>(null);
  readonly tiles = TILES;

  formatCount = formatCount;
  formatPercent = formatPercent;

  ngOnInit(): void {
    this.analytics
      .dashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (summary) => {
          this.summary.set(summary);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(this.formatError(err));
          this.loading.set(false);
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view analytics.';
    if (err instanceof ApiNotFoundError) return 'Analytics overview not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load analytics overview.';
  }
}
