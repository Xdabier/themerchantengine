import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { KpiCardComponent } from '@admin-ui';
import {
  AnalyticsService,
  AuditLogService,
  type TimeseriesMetric,
  type TimeseriesResponse,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { ActivityFeedComponent, type ActivityItem } from './activity-feed.component';
import { QuickActionsComponent } from './quick-actions.component';
import { AuthStore } from '../../core/stores/auth.store';
import { activitySentence } from '../../shared/format/audit-labels';
import { adminIntlTag } from '../../shared/format/intl-tag';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

interface DashboardSummary {
  today: { orders: number; revenue: number; uniqueSessions: number; conversionRate: number };
  thisWeek: { orders: number; revenue: number; uniqueSessions: number; conversionRate: number };
  thisMonth: { orders: number; revenue: number; uniqueSessions: number; conversionRate: number };
}

/**
 * Admin home — KPI grid + activity feed + quick actions.
 *
 * Data contract
 * - `AnalyticsService.dashboard()` returns `{today, thisWeek, thisMonth}` with
 *   {orders, revenue, uniqueSessions, conversionRate} per period.
 * - `AuditLogService.list({pageSize: 8})` feeds the activity sidebar.
 *
 * Loading posture
 * - `loading` signal stays true until BOTH calls settle; KPI cards + activity
 *   feed render skeletons meanwhile. Errors surface as an inline banner — the
 *   first failure wins so an activity fetch error doesn't shadow a KPI error.
 *
 * Sparkline trends come from `AnalyticsService.timeseries()` — one call per
 * metric (orders, revenue) over the last 30 days at daily granularity. The
 * bucket.value arrays are fed straight to each KPI card's `trendPoints`
 * input; a sparkline only renders once ≥ 2 buckets are present.
 */
@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [KpiCardComponent, ActivityFeedComponent, QuickActionsComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="dashboard-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Overview</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Dashboard</h1>
        </div>
        @if (error()) {
          <p
            class="border border-status-error text-ink p-3 tabular text-xs"
            data-testid="dashboard-error"
            role="alert"
          >
            {{ error() }}
          </p>
        }
      </header>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-grid">
        <app-kpi-card
          label="Orders · today"
          [value]="formatCount(summary()?.today?.orders)"
          [loading]="loading()"
          [sublabel]="'Last 24 hours'"
          [trendPoints]="ordersTrend()"
          testId="kpi-orders-today"
        />
        <app-kpi-card
          label="Revenue · this week"
          [value]="summary()?.thisWeek?.revenue | money"
          [loading]="loading()"
          [sublabel]="'Gross'"
          [trendPoints]="revenueTrend()"
          testId="kpi-revenue-week"
        />
        <app-kpi-card
          label="Orders · this month"
          [value]="formatCount(summary()?.thisMonth?.orders)"
          [loading]="loading()"
          [sublabel]="'Month-to-date'"
          [trendPoints]="ordersTrend()"
          testId="kpi-orders-month"
        />
        <app-kpi-card
          label="Revenue · this month"
          [value]="summary()?.thisMonth?.revenue | money"
          [loading]="loading()"
          [sublabel]="'Month-to-date'"
          [trendPoints]="revenueTrend()"
          testId="kpi-revenue-month"
        />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2">
          <app-activity-feed
            [items]="activity()"
            [loading]="loading()"
            [linkable]="canViewAuditLogs()"
          />
        </div>
        <app-quick-actions />
      </div>
    </section>
  `,
})
export class DashboardPage implements OnInit, OnDestroy {
  private readonly analytics = inject(AnalyticsService);
  private readonly auditLog = inject(AuditLogService);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly summary = signal<DashboardSummary | null>(null);
  readonly activity = signal<readonly ActivityItem[]>([]);
  readonly error = signal<string | null>(null);
  /** The dashboard route itself carries no audit permission, so gate the links. */
  readonly canViewAuditLogs = computed(() => this.authStore.hasPermission('audit_log:view'));
  readonly ordersTrend = signal<readonly number[]>([]);
  readonly revenueTrend = signal<readonly number[]>([]);

  ngOnInit(): void {
    // KPI + activity gate the loading skeleton; sparkline fetches are
    // secondary — they settle after and just unlock the trend line. A
    // slow timeseries call should never delay the primary numbers.
    let pending = 2;
    const settle = () => {
      pending -= 1;
      if (pending === 0) this.loading.set(false);
    };

    this.analytics
      .dashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (summary) => {
          this.summary.set(summary as DashboardSummary);
          settle();
        },
        error: (err: unknown) => {
          this.error.set(this.formatError(err, 'Could not load KPI summary.'));
          settle();
        },
      });

    this.auditLog
      .list({ pageSize: 8 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.activity.set(res.data.map((row) => this.toActivityItem(row)));
          settle();
        },
        error: (err: unknown) => {
          // Activity is secondary — don't overwrite a more important KPI error.
          if (!this.error()) {
            this.error.set(this.formatError(err, 'Could not load recent activity.'));
          }
          settle();
        },
      });

    this.loadTrend('orders', (points) => this.ordersTrend.set(points));
    this.loadTrend('revenue', (points) => this.revenueTrend.set(points));
  }

  private loadTrend(metric: TimeseriesMetric, apply: (points: number[]) => void): void {
    this.analytics
      .timeseries({ metric, granularity: 'day' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: TimeseriesResponse) => apply(res.buckets.map((b) => b.value)),
        // Trend failure is silent — the sparkline simply doesn't appear; KPI
        // numbers are still valid. Logging gives us a trail in GlobalErrorHandler.
        error: (err: unknown) => console.warn('[dashboard] timeseries failed', metric, err),
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  formatCount(n: number | undefined): string {
    if (n === undefined || n === null) return '—';
    return n.toLocaleString(adminIntlTag());
  }

  private toActivityItem(row: Record<string, unknown>): ActivityItem {
    const record = row as {
      id: string;
      action: string;
      entityType: string;
      entityId: string | null;
      createdAt?: string;
      at?: string;
      user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
      userId?: string | null;
    };
    // The audit-log response carries a joined `user` object ({ firstName,
    // lastName, email }); compose a readable actor from it. Never fall back to
    // the raw `userId` UUID — a system action simply has no user, so null here
    // renders as "System" in the feed.
    const u = record.user;
    const fullName = u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() : '';
    const actor = fullName || u?.email || null;
    return {
      id: record.id,
      sentence: activitySentence({ actor, action: record.action, entityType: record.entityType }),
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId ?? null,
      at: record.createdAt ?? record.at ?? null,
      actor,
    };
  }

  private formatError(err: unknown, fallback: string): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to view the dashboard.';
    if (err instanceof ApiNotFoundError) return 'Dashboard data not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
