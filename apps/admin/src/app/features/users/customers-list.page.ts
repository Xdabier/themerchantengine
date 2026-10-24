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
  UsersService,
  customerSegmentSchema,
  type Customer,
  type CustomerSegment,
  type CustomerSegmentSummary,
  type ListCustomersQuery,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { fullName, segmentLabel, segmentTone } from './users.utils';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

/**
 * `/customers` — paginated customer directory.
 *
 * URL owns page + pageSize + segment + search so deep-links are
 * bookmarkable. Search is debounced (200ms) before updating the URL
 * so rapid keystrokes don't churn navigation history. Segment chips
 * read from `listCustomerSegments()` in parallel with the main fetch
 * so counts surface without blocking the first table render.
 */
@Component({
  selector: 'app-customers-list-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    LoadErrorComponent,
    SkeletonComponent,
    MoneyPipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="customers-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">People</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Customers</h1>
          <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
            Search the directory. Segment chips reflect the latest backend classification.
          </p>
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-4">
        <div class="flex-1 min-w-64 max-w-md" role="search">
          <label for="customer-search" class="sr-only">Search customers</label>
          <input
            id="customer-search"
            type="search"
            inputmode="search"
            autocomplete="off"
            class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line placeholder:text-ink-muted focus:outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            placeholder="Search by email, name, or phone…"
            [value]="search()"
            (input)="onSearch($event)"
            data-testid="customers-search"
          />
        </div>
        <div
          class="flex items-center gap-2 flex-wrap"
          role="group"
          aria-label="Filter customers by segment"
        >
          @for (opt of segmentOptions; track opt.value) {
            <button
              type="button"
              class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [class.border-ink]="segment() === opt.value"
              [class.text-ink]="segment() === opt.value"
              [class.border-line]="segment() !== opt.value"
              [class.text-ink-muted]="segment() !== opt.value"
              [attr.aria-pressed]="segment() === opt.value"
              [attr.data-testid]="'segment-filter-' + (opt.value ?? 'all')"
              (click)="setSegment(opt.value)"
            >
              {{ opt.label }}
              @if (countFor(opt.value); as count) {
                <span class="ml-2 tabular-nums">{{ count }}</span>
              }
            </button>
          }
        </div>
      </div>

      @if (segmentsError()) {
        <app-load-error
          [message]="segmentsError()!"
          [compact]="true"
          [retrying]="segmentsLoading()"
          retryLabel="segment counts"
          testId="customers-segments-degraded"
          (retry)="fetchSegments()"
        />
      }

      <div role="status" aria-live="polite" data-testid="customers-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Customers
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
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
                  Email
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Orders
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Lifetime value
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Segment
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of [0, 1, 2, 3, 4]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td colspan="5" class="px-4 py-16 text-center text-ink-muted tabular text-sm">
                    No customers match the current filter.
                  </td>
                </tr>
              } @else {
                @for (c of rows(); track c.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'customer-row-' + c.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/customers', c.id]"
                        class="tabular text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ name(c) }}
                      </a>
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">{{ c.email }}</td>
                    <td class="px-4 py-3 tabular text-sm tabular-nums text-ink">
                      {{ c.orderCount ?? 0 }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm tabular-nums text-ink">
                      {{ c.totalSpent | money }}
                    </td>
                    <td class="px-4 py-3">
                      @if (c.segment) {
                        <app-badge
                          [tone]="tone(c.segment)"
                          [ariaLabel]="'Segment: ' + segmentLabel(c.segment)"
                        >
                          {{ segmentLabel(c.segment) }}
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
        testIdPrefix="customers"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class CustomersListPage implements OnInit, OnDestroy {
  private readonly users = inject(UsersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();
  private readonly search$ = new Subject<string>();

  protected readonly placeholderRows = [0, 1, 2, 3, 4, 5];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Customer[]>([]);
  readonly total = signal(0);
  readonly segments = signal<readonly CustomerSegmentSummary[]>([]);
  readonly segmentsError = signal<string | null>(null);
  readonly segmentsLoading = signal(false);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly segment = computed(() => this.queryParams()['segment'] ?? null);
  readonly search = computed(() => this.queryParams()['search'] ?? '');
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  /**
   * VIP and HIGH_VALUE are absent on purpose: no backend criteria define them,
   * so those chips could never carry a count or narrow a single row. They come
   * back when a definition exists.
   */
  readonly segmentOptions: ReadonlyArray<{ value: CustomerSegment | null; label: string }> = [
    { value: null, label: 'All' },
    { value: 'LOYAL', label: 'Loyal' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'NEW', label: 'New' },
    { value: 'AT_RISK', label: 'At risk' },
    { value: 'CHURNED', label: 'Churned' },
  ];

  protected readonly name = fullName;
  protected readonly tone = segmentTone;
  protected readonly segmentLabel = segmentLabel;

  countFor(value: string | null): number | null {
    if (!value) return null;
    const hit = this.segments().find((s) => s.segment === value);
    return hit?.count ?? null;
  }

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

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
    this.fetchSegments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setSegment(value: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { segment: value, page: null },
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

  onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search$.next(value);
  }

  private fetch(): void {
    const query: ListCustomersQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    const seg = this.segment();
    if (seg) {
      const parsed = customerSegmentSchema.safeParse(seg);
      if (parsed.success) query.segment = parsed.data;
    }
    const search = this.search().trim();
    if (search) query.search = search;

    this.loading.set(true);
    this.error.set(null);
    this.users
      .listCustomers(query)
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

  fetchSegments(): void {
    this.segmentsLoading.set(true);
    this.users
      .listCustomerSegments()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.segments.set(data);
          this.segmentsError.set(null);
          this.segmentsLoading.set(false);
        },
        error: () => {
          this.segments.set([]);
          this.segmentsError.set('Could not load segment counts.');
          this.segmentsLoading.set(false);
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view customers.';
    if (err instanceof ApiNotFoundError) return 'Customers not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load customers. Please retry.';
  }
}
