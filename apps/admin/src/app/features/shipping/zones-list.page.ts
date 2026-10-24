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
import { ApiError, ApiForbiddenError } from '@admin-types';
import { ShippingService, type ShippingZone } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { countriesPreview, statesSummary, translatableDefault } from './shipping.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

@Component({
  selector: 'app-shipping-zones-list-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, SkeletonComponent, AdminDatePipe, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="shipping-zones-list-page">
      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Shipping zones</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Regional groupings of destinations. Methods attach to a single zone and inherit its
            country + postal coverage.
          </p>
        </div>
        @if (canCreate()) {
          <a
            routerLink="/shipping/zones/new"
            class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
            data-testid="zones-new-cta"
          >
            Create zone
          </a>
        }
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="zones-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Shipping zones
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
                  States
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
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of skeletonRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of [0, 1, 2, 3, 4, 5]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    colspan="6"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="zones-empty"
                  >
                    No shipping zones configured.
                  </td>
                </tr>
              } @else {
                @for (zone of rows(); track zone.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'zone-row-' + zone.id"
                  >
                    <td class="px-4 py-3">
                      @if (canUpdate()) {
                        <a
                          [routerLink]="['/shipping/zones', zone.id, 'edit']"
                          class="text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                          [attr.data-testid]="'zone-link-' + zone.id"
                        >
                          {{ zoneName(zone) }}
                        </a>
                      } @else {
                        <span class="text-sm text-ink">{{ zoneName(zone) }}</span>
                      }
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted">
                      {{ countriesPreview(zone.countries) }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted tabular-nums">
                      {{ statesSummary(zone.states) }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted tabular-nums">
                      {{ zone.priority }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="zone.isActive ? 'success' : 'warning'"
                        [ariaLabel]="zone.isActive ? 'Active zone' : 'Disabled zone'"
                      >
                        {{ zone.isActive ? 'Active' : 'Disabled' }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ zone.updatedAt | adminDate }}
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
        testIdPrefix="zones"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class ShippingZonesListPage implements OnInit, OnDestroy {
  private readonly shipping = inject(ShippingService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly countriesPreview = countriesPreview;
  protected readonly statesSummary = statesSummary;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly ShippingZone[]>([]);
  readonly total = signal(0);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly canCreate = computed(() => this.auth.hasPermission('shipping:create'));
  readonly canUpdate = computed(() => this.auth.hasPermission('shipping:update'));

  zoneName(zone: ShippingZone): string {
    return translatableDefault(zone.name) || '(untitled)';
  }

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

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.shipping
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
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to view shipping zones.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load shipping zones. Please retry.';
  }
}
