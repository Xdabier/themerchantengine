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
import {
  BadgeComponent,
  LoadErrorComponent,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import {
  ReturnsService,
  returnStatusSchema,
  returnReasonSchema,
  type ListReturnsQuery,
  type Return,
  type ReturnsAnalytics,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import {
  formatMoney,
  reasonLabel,
  refundMethodLabel,
  returnStatusTone,
  statusLabel,
} from './returns.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

/**
 * `/refunds` — paginated list of customer returns.
 *
 * URL is the source of truth for `page`, `pageSize`, `status`, and `reason`
 * so the view is bookmarkable. Analytics strip at the top pulls from
 * `/returns/analytics` and degrades silently if the call fails — the list
 * itself must keep rendering even when analytics is unreachable.
 */
@Component({
  selector: 'app-returns-list-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    LoadErrorComponent,
    SkeletonComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="returns-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Returns</h1>
          <p class="mt-3 text-ink-muted tabular text-sm">
            Customer returns awaiting review, receiving, or refund.
          </p>
        </div>
      </header>

      @if (analyticsError()) {
        <app-load-error
          [message]="analyticsError()!"
          [compact]="true"
          [retrying]="analyticsLoading()"
          retryLabel="returns summary"
          testId="returns-analytics-degraded"
          (retry)="fetchAnalytics()"
        />
      }

      @if (analytics(); as a) {
        <dl
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          data-testid="returns-analytics"
          aria-label="Returns analytics"
        >
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Total returns</dt>
            <dd class="mt-2 text-2xl font-bold tabular">{{ a.totalReturns }}</dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Return rate</dt>
            <dd class="mt-2 text-2xl font-bold tabular">{{ formatRate(a.returnRate) }}</dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Refund methods</dt>
            <dd class="mt-2 text-sm tabular text-ink">
              @if (a.refundsByMethod.length === 0) {
                —
              } @else {
                @for (m of a.refundsByMethod; track m.method) {
                  <span class="inline-block mr-3">
                    <span class="text-ink-muted">{{ refundMethodLabel(m.method) }}:</span>
                    <span class="tabular-nums ml-1">{{ m.count }}</span>
                  </span>
                }
              }
            </dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Top reasons</dt>
            <dd class="mt-2 text-sm tabular text-ink">
              @if (a.byReason.length === 0) {
                —
              } @else {
                @for (r of a.byReason; track r.reason) {
                  <span class="inline-block mr-3">
                    <span class="text-ink-muted">{{ reasonLabel(r.reason) }}:</span>
                    <span class="tabular-nums ml-1">{{ r.count }}</span>
                  </span>
                }
              }
            </dd>
          </div>
        </dl>
      }

      <div
        class="flex items-center gap-3 flex-wrap"
        role="group"
        aria-label="Filter returns by status"
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
            [attr.data-testid]="'returns-status-filter-' + (opt.value ?? 'all')"
            (click)="setStatus(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      @if (error()) {
        <p
          class="border border-status-error text-ink p-3 tabular text-xs"
          data-testid="returns-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Returns list
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Return
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Order
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Requested
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Reason
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Refund
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
                  <td colspan="6" class="px-4 py-16 text-center text-ink-muted tabular text-sm">
                    No returns match the current filter.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'return-row-' + item.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/returns', item.id]"
                        class="tabular text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ item.returnNumber ?? item.id }}
                      </a>
                    </td>
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/orders', item.orderId]"
                        class="tabular text-sm text-ink-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ item.order?.orderNumber ?? item.orderId }}
                      </a>
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ item.requestedAt ?? item.createdAt | adminDate }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink">
                      {{ reasonLabel(item.reason) }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink tabular-nums">
                      {{ formatMoney(item.refundAmount, item.order?.currency) }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(item.status)"
                        [ariaLabel]="'Return status: ' + statusLabel(item.status)"
                      >
                        {{ statusLabel(item.status) }}
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
        testIdPrefix="returns"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class ReturnsListPage implements OnInit, OnDestroy {
  private readonly returnsService = inject(ReturnsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2, 3, 4, 5, 6, 7];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Return[]>([]);
  readonly total = signal(0);
  readonly analytics = signal<ReturnsAnalytics | null>(null);
  readonly analyticsError = signal<string | null>(null);
  readonly analyticsLoading = signal(false);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly status = computed(() => this.queryParams()['status'] ?? null);
  readonly reason = computed(() => this.queryParams()['reason'] ?? null);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly statusOptions = [
    { value: null, label: 'All' },
    { value: 'REQUESTED', label: 'Requested' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'ITEM_RECEIVED', label: 'Received' },
    { value: 'REFUND_PROCESSED', label: 'Refunded' },
    { value: 'CLOSED', label: 'Closed' },
    { value: 'REJECTED', label: 'Rejected' },
  ] as const;
  protected readonly formatMoney = formatMoney;
  protected readonly reasonLabel = reasonLabel;
  protected readonly refundMethodLabel = refundMethodLabel;
  protected readonly statusLabel = statusLabel;
  protected readonly statusTone = returnStatusTone;

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.fetch();
    });
    this.fetchAnalytics();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setStatus(status: string | null): void {
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

  formatRate(rate: number): string {
    return `${rate.toFixed(1)}%`;
  }

  private fetch(): void {
    const query: ListReturnsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    const status = this.status();
    if (status) {
      const parsed = returnStatusSchema.safeParse(status);
      if (parsed.success) query.status = parsed.data;
    }
    const reason = this.reason();
    if (reason) {
      const parsed = returnReasonSchema.safeParse(reason);
      if (parsed.success) query.reason = parsed.data;
    }

    this.loading.set(true);
    this.error.set(null);
    this.returnsService
      .list(query)
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

  // The list must still render when the aggregation endpoint is slow or
  // unreachable, but the operator has to know the strip is missing rather than
  // reading its absence as "no returns at all".
  fetchAnalytics(): void {
    this.analyticsLoading.set(true);
    this.returnsService
      .analytics()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.analytics.set(res);
          this.analyticsError.set(null);
          this.analyticsLoading.set(false);
        },
        error: () => {
          this.analytics.set(null);
          this.analyticsError.set('Could not load the returns summary.');
          this.analyticsLoading.set(false);
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view returns.';
    if (err instanceof ApiNotFoundError) return 'Returns not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load returns. Please retry.';
  }
}
