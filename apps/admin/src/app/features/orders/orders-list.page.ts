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
import { BadgeComponent, ButtonComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import { AuthStore } from '../../core/stores/auth.store';
import {
  OrdersService,
  orderStatusSchema,
  type ListOrdersQuery,
  type Order,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import {
  customerLabel,
  formatMoney,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
  paymentStatusTone,
} from './orders.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

/**
 * `/orders` — paginated order list.
 *
 * URL as source of truth
 * - `page`, `pageSize`, and `status` are query params so the view is
 *   bookmarkable, shareable, and survives a refresh. Navigation writes
 *   params back via `router.navigate(..., { queryParamsHandling: 'merge' })`.
 *
 * Data
 * - `OrdersService.list()` handles envelope + Zod parse. On 403 we show a
 *   permission-safe message instead of the raw server body.
 */
@Component({
  selector: 'app-orders-list-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    SkeletonComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="orders-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Orders</h1>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          @if (canCreate()) {
            <a
              routerLink="/orders/new"
              class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
              data-testid="orders-new-cta"
            >
              New order
            </a>
          }
          <app-button
            variant="secondary"
            size="md"
            (clicked)="exportCsv()"
            [loading]="exporting()"
            [disabled]="exporting()"
            data-testid="orders-export-csv"
          >
            Export CSV
          </app-button>
          <div class="min-w-64 max-w-md flex-1" role="search">
            <label for="orders-search" class="sr-only">Search orders</label>
            <input
              id="orders-search"
              type="search"
              inputmode="search"
              autocomplete="off"
              class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line placeholder:text-ink-muted focus:outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              placeholder="Search by order number, customer name, or email…"
              [value]="search()"
              (input)="onSearch($event)"
              data-testid="orders-search"
            />
          </div>
          <div
            class="flex items-center gap-2 flex-wrap"
            role="group"
            aria-label="Filter orders by status"
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
                [attr.data-testid]="'status-filter-' + (opt.value ?? 'all')"
                (click)="setStatus(opt.value)"
              >
                {{ opt.label }}
              </button>
            }
          </div>
        </div>
      </header>

      @if (error()) {
        <p
          class="border border-status-error text-ink p-3 tabular text-xs"
          data-testid="orders-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Orders list
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
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
                  Customer
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Date
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Total
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Status
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Payment
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
                    No orders match the current filter.
                  </td>
                </tr>
              } @else {
                @for (order of rows(); track order.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'order-row-' + order.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/orders', order.id]"
                        class="tabular text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ order.orderNumber ?? order.id }}
                      </a>
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink">
                      {{ customerLabel(order.user) }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ order.createdAt | adminDate }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink tabular-nums">
                      {{ formatMoney(order.total, order.currency) }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(order.status)"
                        [ariaLabel]="'Order status: ' + orderStatusLabel(order.status)"
                      >
                        {{ orderStatusLabel(order.status) }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3">
                      @if (order.paymentStatus) {
                        <app-badge
                          [tone]="paymentTone(order.paymentStatus)"
                          [ariaLabel]="'Payment status: ' + paymentStatusLabel(order.paymentStatus)"
                        >
                          {{ paymentStatusLabel(order.paymentStatus) }}
                        </app-badge>
                      } @else {
                        <span class="text-ink-muted tabular text-sm">—</span>
                      }
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
        testIdPrefix="orders"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class OrdersListPage implements OnInit, OnDestroy {
  private readonly ordersService = inject(OrdersService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();
  private readonly search$ = new Subject<string>();

  readonly canCreate = computed(() => this.auth.hasPermission('orders:create'));

  protected readonly placeholderRows = [0, 1, 2, 3, 4, 5, 6, 7];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Order[]>([]);
  readonly total = signal(0);
  readonly exporting = signal(false);

  /**
   * Derive paging + filter state from the URL so navigation is bookmarkable.
   * We read the raw query params and coerce; defaults fill in the gaps.
   */
  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly status = computed(() => this.queryParams()['status'] ?? null);
  readonly search = computed(() => this.queryParams()['search'] ?? '');
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly statusOptions = [
    { value: null, label: 'All' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'CONFIRMED', label: 'Confirmed' },
    { value: 'SHIPPED', label: 'Shipped' },
    { value: 'DELIVERED', label: 'Delivered' },
    { value: 'CANCELLED', label: 'Cancelled' },
  ] as const;
  protected readonly formatMoney = formatMoney;
  protected readonly customerLabel = customerLabel;
  protected readonly statusTone = orderStatusTone;
  protected readonly paymentTone = paymentStatusTone;
  protected readonly orderStatusLabel = orderStatusLabel;
  protected readonly paymentStatusLabel = paymentStatusLabel;

  ngOnInit(): void {
    this.search$
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((term) => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { search: term || null, page: null },
          queryParamsHandling: 'merge',
        });
      });

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.fetch();
    });
  }

  onSearch(event: Event): void {
    this.search$.next((event.target as HTMLInputElement).value);
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

  exportCsv(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    const query: ListOrdersQuery = {};
    const status = this.status();
    if (status) {
      const parsed = orderStatusSchema.safeParse(status);
      if (parsed.success) query.status = parsed.data;
    }
    const search = this.search().trim();
    if (search) query.search = search;
    this.ordersService
      .exportCsv(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          this.triggerCsvDownload(blob);
          this.exporting.set(false);
        },
        error: () => {
          this.exporting.set(false);
          this.error.set('Could not export CSV. Please retry.');
        },
      });
  }

  private triggerCsvDownload(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `orders-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private fetch(): void {
    const query: ListOrdersQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    const status = this.status();
    if (status) {
      const parsed = orderStatusSchema.safeParse(status);
      if (parsed.success) query.status = parsed.data;
    }
    const search = this.search().trim();
    if (search) query.search = search;

    this.loading.set(true);
    this.error.set(null);
    this.ordersService
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

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view orders.';
    if (err instanceof ApiNotFoundError) return 'Orders not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load orders. Please retry.';
  }
}
