import { Dialog } from '@angular/cdk/dialog';
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
  ButtonComponent,
  openConfirmDialog,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import { PromotionsService, type ListPromotionsQuery, type Promotion } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  formatDateRange,
  formatPromotionDiscount,
  promotionLabel,
  promotionStatus,
  promotionStatusTone,
  promotionTypeLabel,
} from './promotions.utils';
import { CurrencyStore } from '../../core/stores/currency.store';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/promotions` — paginated promotion list.
 *
 * URL owns `page`, `pageSize`, and `status` (live/scheduled/expired/
 * inactive) so deep-links + refresh are lossless. The status filter
 * maps client-side to a backend `isActive` toggle when possible
 * (inactive only); live/scheduled/expired are derived post-fetch
 * because the backend returns all active rows regardless of window.
 */
@Component({
  selector: 'app-promotions-list-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="promotions-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Promotions</h1>
          <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
            Coupons, automatic discounts, and BOGO offers. Filter by status to focus on live
            campaigns or prep work.
          </p>
        </div>
        <div
          class="flex items-center gap-2 flex-wrap"
          role="group"
          aria-label="Filter promotions by status"
        >
          @for (opt of statusOptions; track opt.value) {
            <button
              type="button"
              class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [class.border-ink]="status() === opt.value"
              [class.text-ink]="status() === opt.value"
              [class.border-line]="status() !== opt.value"
              [class.text-ink-muted]="status() !== opt.value"
              [attr.aria-pressed]="status() === opt.value"
              [attr.data-testid]="'promo-filter-' + (opt.value ?? 'all')"
              (click)="setStatus(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>
      </header>

      <div role="status" aria-live="polite" data-testid="promotions-error">
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
              Promotions list
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Name
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Code
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Type
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Discount
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Window
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Status
                </th>
                @if (canDeactivateAny()) {
                  <th scope="col" class="px-4 py-3">
                    <span class="sr-only">Row actions</span>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of skeletonCells(); track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    [attr.colspan]="emptyStateColspan()"
                    class="px-4 py-16 text-center text-ink-muted tabular text-sm"
                  >
                    No promotions match the current filter.
                  </td>
                </tr>
              } @else {
                @for (promo of rows(); track promo.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'promo-row-' + promo.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/promotions', promo.id]"
                        class="tabular text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ label(promo) }}
                      </a>
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      @if (promo.couponCode) {
                        <code class="font-mono text-xs">{{ promo.couponCode }}</code>
                      } @else {
                        —
                      }
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ typeLabel(promo.type) }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink tabular-nums">
                      {{ discount(promo) }}
                    </td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">
                      {{ dateRange(promo.startsAt, promo.endsAt) }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(computedStatus(promo))"
                        [ariaLabel]="'Status: ' + computedStatus(promo)"
                      >
                        {{ computedStatus(promo) }}
                      </app-badge>
                    </td>
                    @if (canDeactivateAny()) {
                      <td class="px-4 py-3 text-right">
                        @if (computedStatus(promo) !== 'inactive') {
                          <app-button
                            variant="destructive"
                            size="sm"
                            [disabled]="busyId() === promo.id"
                            [loading]="busyId() === promo.id"
                            [ariaLabel]="'Deactivate ' + label(promo)"
                            [testId]="'promo-row-deactivate-' + promo.id"
                            (clicked)="confirmDeactivate(promo)"
                          >
                            Deactivate
                          </app-button>
                        }
                      </td>
                    }
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
        testIdPrefix="promotions"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class PromotionsListPage implements OnInit, OnDestroy {
  private readonly service = inject(PromotionsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authStore = inject(AuthStore);
  private readonly currencyStore = inject(CurrencyStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2, 3, 4, 5];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly busyId = signal<string | null>(null);
  private readonly allRows = signal<readonly Promotion[]>([]);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly status = computed(() => this.queryParams()['status'] ?? null);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly rows = computed(() => {
    const filter = this.status();
    const all = this.allRows();
    if (!filter) return all;
    return all.filter((p) => promotionStatus(p) === filter);
  });

  readonly statusOptions = [
    { value: null, label: 'All' },
    { value: 'live', label: 'Live' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'expired', label: 'Expired' },
    { value: 'inactive', label: 'Inactive' },
  ] as const;

  protected readonly label = (p: Pick<Promotion, 'name'>): string =>
    promotionLabel(p, this.authStore.locale(), this.storeSettings.defaultLocale());
  protected readonly typeLabel = promotionTypeLabel;
  protected readonly discount = (p: Promotion) =>
    formatPromotionDiscount(p, this.currencyStore.config());
  /**
   * A plain method, not a computed: per the project's zoneless rule a template
   * helper reads the store signal on every pass so a late settings hydration
   * re-renders the window.
   */
  protected dateRange(start?: string | null, end?: string | null): string {
    return formatDateRange(start, end, this.storeSettings.timezone());
  }
  protected readonly statusTone = promotionStatusTone;
  protected readonly computedStatus = promotionStatus;

  readonly canCreate = computed(() =>
    this.authStore.hasAnyPermission(['promotions:create', 'promotions:manage']),
  );

  readonly canDeactivateAny = computed(() =>
    this.authStore.hasAnyPermission(['promotions:delete', 'promotions:manage']),
  );

  readonly emptyStateColspan = computed(() => (this.canDeactivateAny() ? 7 : 6));
  readonly skeletonCells = computed(() =>
    this.canDeactivateAny() ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5],
  );

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
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

  async confirmDeactivate(promo: Promotion): Promise<void> {
    if (this.busyId()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Deactivate this promotion?',
      body: 'The promotion will stop applying immediately. You can reactivate it later from the detail page.',
      confirmLabel: 'Deactivate',
      tone: 'destructive',
    });
    if (!ok) return;

    this.busyId.set(promo.id);
    this.error.set(null);
    this.service
      .deactivate(promo.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.fetch();
        },
        error: (err: unknown) => {
          this.busyId.set(null);
          this.error.set(this.formatError(err));
        },
      });
  }

  private fetch(): void {
    const query: ListPromotionsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    // Backend-side: only `isActive=false` maps to a single filter; derive
    // live/scheduled/expired client-side from the returned rows.
    if (this.status() === 'inactive') query.isActive = false;

    this.loading.set(true);
    this.error.set(null);
    this.service
      .list(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.allRows.set(res.data);
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view promotions.';
    if (err instanceof ApiNotFoundError) return 'Promotions not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load promotions. Please retry.';
  }
}
