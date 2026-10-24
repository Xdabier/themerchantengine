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
import { AnalyticsService, type ProductAnalyticsResponse } from '@admin-services';
import { pickTranslation } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AnalyticsDateRangeComponent, type DateRangeValue } from './date-range.component';
import { formatPercent, rangeLabel } from './analytics.utils';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

/**
 * `/analytics/products` — product-performance table per screen-inventory §1.3.
 * Sortable columns, date-range picker, brutalist borders only.
 */
@Component({
  selector: 'app-analytics-products-page',
  standalone: true,
  imports: [AnalyticsDateRangeComponent, SkeletonComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="analytics-products-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Analytics</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Product performance</h1>
        </div>
      </header>

      <app-analytics-date-range (rangeChanged)="reload($event)" />

      @if (rangeEcho(); as label) {
        <p class="text-xs tabular text-ink-muted" data-testid="analytics-products-range">
          Showing {{ label }}
        </p>
      }

      <div
        class="min-h-[2rem] max-w-sm"
        data-testid="analytics-products-error"
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
      } @else {
        <div class="overflow-x-auto" data-testid="analytics-products-table">
          @if (rows().length === 0) {
            <p class="text-sm text-ink" data-testid="analytics-products-empty">
              @if (rangeEcho(); as label) {
                No product events between {{ label }}.
              } @else {
                No product events recorded yet.
              }
            </p>
          } @else {
            <table class="w-full border border-line" aria-label="Product performance">
              <thead>
                <tr class="bg-surface border-b border-line">
                  <th
                    scope="col"
                    class="text-left px-4 py-3 text-xs tracking-widest uppercase text-ink-muted"
                  >
                    Product
                  </th>
                  <th
                    scope="col"
                    class="text-right px-4 py-3 text-xs tracking-widest uppercase text-ink-muted"
                  >
                    Views
                  </th>
                  <th
                    scope="col"
                    class="text-right px-4 py-3 text-xs tracking-widest uppercase text-ink-muted"
                  >
                    Carts
                  </th>
                  <th
                    scope="col"
                    class="text-right px-4 py-3 text-xs tracking-widest uppercase text-ink-muted"
                  >
                    Purchases
                  </th>
                  <th
                    scope="col"
                    class="text-right px-4 py-3 text-xs tracking-widest uppercase text-ink-muted"
                  >
                    Conv.
                  </th>
                  <th
                    scope="col"
                    class="text-right px-4 py-3 text-xs tracking-widest uppercase text-ink-muted"
                  >
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.productId) {
                  <tr class="border-b border-line">
                    <td class="px-4 py-3 text-sm text-ink">
                      {{ translate(r.name) }}
                    </td>
                    <td class="px-4 py-3 text-right tabular-nums">{{ r.views }}</td>
                    <td class="px-4 py-3 text-right tabular-nums">{{ r.carts }}</td>
                    <td class="px-4 py-3 text-right tabular-nums">{{ r.purchases }}</td>
                    <td class="px-4 py-3 text-right tabular-nums">
                      {{ formatPercent(r.conversionRate) }}
                    </td>
                    <td class="px-4 py-3 text-right tabular-nums">
                      {{ r.revenue | money }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }
    </section>
  `,
})
export class AnalyticsProductsPage implements OnInit, OnDestroy {
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
  readonly rows = signal<ProductAnalyticsResponse>([]);

  formatPercent = formatPercent;

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

  translate(name: ProductAnalyticsResponse[number]['name']): string {
    return (
      pickTranslation(
        name,
        this.storeSettings.defaultLocale(),
        '',
        this.storeSettings.defaultLocale(),
      ) || name.default
    );
  }

  private load(range: DateRangeValue): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .products(range)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows.set(res);
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
    if (err instanceof ApiNotFoundError) return 'Product analytics not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load product analytics.';
  }
}
