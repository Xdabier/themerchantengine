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
import { BadgeComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import { TaxService, type TaxZone } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { TranslatablePipe } from '../../../shared/pipes/translatable.pipe';
import { Subject, takeUntil } from 'rxjs';

/**
 * `/shipping/tax` — tax zone list.
 *
 * Rate column shows the decimal as a percentage string for operator
 * readability (backend persists the fractional form). Default zone is
 * badged so operators can't forget which one applies to uncovered
 * countries.
 */
@Component({
  selector: 'app-tax-zones-list-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, SkeletonComponent, TranslatablePipe, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="tax-zones-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Tax zones</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Rates applied at checkout based on the shipping country. One zone may be flagged default
            to cover countries not matched anywhere else.
          </p>
        </div>
      </header>

      <div role="alert" aria-atomic="true" data-testid="tax-zones-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Tax zones
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
                  Countries
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Rate
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Priority
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
                    @for (__ of [0, 1, 2, 3, 4]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td colspan="5" class="px-4 py-16 text-center text-ink-muted text-sm">
                    No tax zones configured.
                  </td>
                </tr>
              } @else {
                @for (z of rows(); track z.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'tax-zone-row-' + z.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/shipping/tax', z.id]"
                        class="text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ z.name | translatable }}
                      </a>
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted">
                      {{ countryList(z) }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink font-mono tabular-nums">
                      {{ formatRate(z.rate) }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted font-mono tabular-nums">
                      {{ z.priority ?? 0 }}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2 flex-wrap">
                        <app-badge
                          [tone]="z.isActive === false ? 'neutral' : 'success'"
                          [ariaLabel]="z.isActive === false ? 'Disabled' : 'Active'"
                        >
                          {{ z.isActive === false ? 'Disabled' : 'Active' }}
                        </app-badge>
                        @if (z.isDefault) {
                          <app-badge tone="info" [ariaLabel]="'Default zone'"> Default </app-badge>
                        }
                        @if (z.isCompound) {
                          <app-badge tone="warning" [ariaLabel]="'Compound tax'">
                            Compound
                          </app-badge>
                        }
                      </div>
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
        testIdPrefix="tax-zones"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class TaxZonesListPage implements OnInit, OnDestroy {
  private readonly tax = inject(TaxService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly TaxZone[]>([]);
  readonly total = signal(0);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  countryList(zone: TaxZone): string {
    const list = zone.countries ?? [];
    if (list.length === 0) return '—';
    if (list.length <= 4) return list.join(', ');
    return `${list.slice(0, 4).join(', ')} +${list.length - 4}`;
  }

  formatRate(rate: number): string {
    // Backend stores 0..1 fractions — surface as a % string.
    const pct = rate * 100;
    return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.tax
      .listZones({ page: this.page(), pageSize: this.pageSize() })
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view tax zones.';
    if (err instanceof ApiNotFoundError) return 'Tax zones not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load tax zones.';
  }
}
