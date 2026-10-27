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
import { ActivatedRoute, Router } from '@angular/router';
import { BadgeComponent, ButtonComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import {
  CampaignsService,
  type ListSubscribersQuery,
  type Subscriber,
  type SubscriberStatus,
} from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { sourceLabel } from './campaigns.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

function subStatus(s: Subscriber): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (s.unsubscribedAt) return { label: 'Unsubscribed', tone: 'warning' };
  if (s.confirmedAt) return { label: 'Confirmed', tone: 'success' };
  return { label: 'Pending', tone: 'neutral' };
}

/** `/subscribers` — the newsletter audience list. */
@Component({
  selector: 'app-subscribers-list-page',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, SkeletonComponent, AdminDatePipe, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="subscribers-list-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Marketing</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Subscribers</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          The newsletter audience. Only confirmed subscribers receive campaigns (double opt-in).
        </p>
      </header>

      <div class="flex-1 min-w-64 max-w-md" role="search">
        <label for="subscribers-search" class="sr-only">Search subscribers</label>
        <input
          id="subscribers-search"
          type="search"
          inputmode="search"
          autocomplete="off"
          class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line placeholder:text-ink-muted focus:outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          placeholder="Search by email…"
          [value]="search()"
          (input)="onSearch($event)"
          data-testid="subscribers-search"
        />
      </div>

      <div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by status">
        @for (opt of statusOptions; track opt.value) {
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="statusFilter() === opt.value"
            [class.text-ink]="statusFilter() === opt.value"
            [class.border-line]="statusFilter() !== opt.value"
            [class.text-ink-muted]="statusFilter() !== opt.value"
            [attr.aria-pressed]="statusFilter() === opt.value"
            [attr.data-testid]="'sub-status-' + (opt.value ?? 'all')"
            (click)="setStatus(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <div role="alert" data-testid="subscribers-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>
      <div role="status" aria-live="polite" data-testid="subscribers-notice">
        @if (notice()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">
            {{ notice() }}
          </p>
        }
      </div>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Newsletter subscribers
            </caption>
            <thead class="border-b border-line">
              <tr class="text-start">
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
                  Status
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Source
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Joined
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  <span class="sr-only">Actions</span>
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
                    No subscribers match this filter.
                  </td>
                </tr>
              } @else {
                @for (s of rows(); track s.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated"
                    [attr.data-testid]="'sub-row-' + s.id"
                  >
                    <td class="px-4 py-3 tabular text-xs text-ink break-all max-w-xs">
                      {{ s.email }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge [tone]="status(s).tone" [ariaLabel]="status(s).label">{{
                        status(s).label
                      }}</app-badge>
                    </td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">
                      {{ sourceLabel(s.source) }}
                    </td>
                    <td class="px-4 py-3 tabular-nums text-xs text-ink-muted">
                      {{ s.createdAt | adminDate: 'date' }}
                    </td>
                    <td class="px-4 py-3 text-end">
                      @if (canManage()) {
                        <app-button
                          variant="ghost"
                          size="sm"
                          [disabled]="busyId() !== null"
                          [loading]="busyId() === s.id"
                          (clicked)="toggle(s)"
                          [attr.data-testid]="'sub-toggle-' + s.id"
                          [ariaLabel]="
                            (s.unsubscribedAt ? 'Re-activate ' : 'Unsubscribe ') + s.email
                          "
                        >
                          {{ s.unsubscribedAt ? 'Re-activate' : 'Unsubscribe' }}
                        </app-button>
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
        testIdPrefix="subscribers"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class SubscribersListPage implements OnInit, OnDestroy {
  private readonly service = inject(CampaignsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();
  private readonly search$ = new Subject<string>();

  protected readonly placeholderRows = [0, 1, 2, 3];
  protected readonly status = subStatus;
  protected readonly sourceLabel = sourceLabel;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly rows = signal<readonly Subscriber[]>([]);
  readonly total = signal(0);
  readonly busyId = signal<string | null>(null);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly search = computed(() => this.queryParams()['search'] ?? '');
  readonly statusFilter = computed<SubscriberStatus | null>(() => {
    const raw = this.queryParams()['status'];
    return raw === 'confirmed' || raw === 'pending' || raw === 'unsubscribed'
      ? (raw as SubscriberStatus)
      : null;
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly canManage = computed(() => this.authStore.hasAnyPermission(['campaigns:manage']));

  readonly statusOptions: ReadonlyArray<{ value: SubscriberStatus | null; label: string }> = [
    { value: null, label: 'All' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'pending', label: 'Pending' },
    { value: 'unsubscribed', label: 'Unsubscribed' },
  ];

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
  }

  onSearch(event: Event): void {
    this.search$.next((event.target as HTMLInputElement).value);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setStatus(value: SubscriberStatus | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status: value, page: null },
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

  toggle(s: Subscriber): void {
    if (this.busyId()) return;
    this.busyId.set(s.id);
    this.error.set(null);
    this.notice.set(null);
    this.service.updateSubscriber(s.id, { unsubscribed: !s.unsubscribedAt }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notice.set(`Updated ${s.email}.`);
        this.fetch();
        setTimeout(() => this.notice.set(null), 3000);
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.error.set(this.formatError(err, 'Could not update the subscriber.'));
      },
    });
  }

  private fetch(): void {
    const query: ListSubscribersQuery = { page: this.page(), pageSize: this.pageSize() };
    if (this.statusFilter()) query.status = this.statusFilter() as SubscriberStatus;
    const search = this.search().trim();
    if (search) query.search = search;
    this.loading.set(true);
    this.error.set(null);
    this.service
      .listSubscribers(query)
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

  private formatError(err: unknown, fallback = 'Could not load subscribers.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view subscribers.';
    if (err instanceof ApiError) return err.message;
    return fallback;
  }
}
