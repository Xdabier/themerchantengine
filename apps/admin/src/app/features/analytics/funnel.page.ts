import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { SkeletonComponent } from '@admin-ui';
import { AnalyticsService, type FunnelResponse } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AnalyticsDateRangeComponent, type DateRangeValue } from './date-range.component';
import { formatPercent, rangeLabel } from './analytics.utils';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';
import { humanizeCode } from '../../shared/format/enum-label';

const STEP_LABELS: Record<string, string> = {
  product_view: 'Product views',
  add_to_cart: 'Add to cart',
  begin_checkout: 'Begin checkout',
  add_shipping_info: 'Add shipping info',
  add_payment_info: 'Add payment info',
  purchase: 'Purchase',
};

/**
 * `/analytics/funnel` — conversion funnel per screen-inventory §1.2.
 * One bar per stage, 1 px surface on emphasis; drop-off % in tabular.
 */
@Component({
  selector: 'app-analytics-funnel-page',
  standalone: true,
  imports: [AnalyticsDateRangeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="analytics-funnel-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Analytics</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Conversion funnel</h1>
        </div>
      </header>

      <app-analytics-date-range (rangeChanged)="reload($event)" />

      @if (rangeEcho(); as label) {
        <p class="text-xs tabular text-ink-muted" data-testid="analytics-funnel-range">
          Showing {{ label }}
        </p>
      }

      <div
        class="min-h-[2rem] max-w-sm"
        data-testid="analytics-funnel-error"
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
      } @else if (funnel().length === 0) {
        <p class="text-sm text-ink" data-testid="analytics-funnel-chart">
          @if (rangeEcho(); as label) {
            No funnel events between {{ label }}.
          } @else {
            No funnel events recorded yet.
          }
        </p>
      } @else {
        <div
          class="flex flex-col gap-3 max-w-3xl"
          data-testid="analytics-funnel-chart"
          role="list"
          aria-label="Funnel stages"
        >
          @for (s of funnel(); track s.step) {
            <div
              class="border border-line bg-surface p-4 flex flex-col gap-2"
              role="listitem"
              [attr.data-testid]="'analytics-funnel-step-' + s.step"
            >
              <div class="flex items-baseline justify-between gap-3 flex-wrap">
                <p class="text-xs tracking-widest uppercase text-ink-muted">
                  {{ stepLabel(s.step) }}
                </p>
                <p class="text-2xl font-bold tabular-nums">{{ s.count }}</p>
              </div>
              <div
                class="h-3 bg-surface-elevated border border-line"
                [attr.aria-label]="'Overall conversion ' + formatPercent(s.overallConversionRate)"
                role="img"
              >
                <div
                  class="h-full bg-surface-emphasis"
                  [style.width.%]="s.overallConversionRate"
                ></div>
              </div>
              @if (!$first) {
                <p
                  class="text-xs tracking-widest uppercase text-ink-muted"
                  [attr.data-testid]="'analytics-funnel-dropoff-' + s.step"
                >
                  Drop-off
                  <span class="tabular-nums text-ink ml-2">
                    {{ formatPercent(s.dropOffRate) }}
                  </span>
                </p>
              }
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class AnalyticsFunnelPage implements OnInit, OnDestroy {
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
  readonly funnel = signal<FunnelResponse>([]);

  formatPercent = formatPercent;

  stepLabel(step: string): string {
    return STEP_LABELS[step] ?? humanizeCode(step);
  }

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

  private load(range: DateRangeValue): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .funnel(range)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.funnel.set(res);
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
    if (err instanceof ApiNotFoundError) return 'Funnel report not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load the funnel report.';
  }
}
