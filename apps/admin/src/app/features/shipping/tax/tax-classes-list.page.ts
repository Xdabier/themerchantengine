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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  LoadErrorComponent,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import { TaxService, type TaxClass, type TaxZone } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, pickTranslation } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../../core/stores/auth.store';
import { TranslatablePipe } from '../../../shared/pipes/translatable.pipe';
import { StoreSettingsStore } from '../../../core/stores/store-settings.store';

/**
 * `/shipping/tax/classes` — paginated tax-class catalogue with an
 * optional `?zoneId=` filter. Zone names are resolved via a sibling
 * `listZones()` call so the table never shows raw UUIDs. The "New
 * class" button is only rendered for sessions that can manage.
 */
@Component({
  selector: 'app-tax-classes-list-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    LoadErrorComponent,
    SkeletonComponent,
    TranslatablePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="tax-classes-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Tax classes</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Rate tiers that apply inside a tax zone — Standard, Reduced, Zero-Rated, Exempt. One
            class per zone may be flagged default.
          </p>
        </div>
        @if (canManage()) {
          <app-button
            variant="primary"
            size="md"
            routerLink="/shipping/tax/classes/new"
            data-testid="tax-classes-new"
            ariaLabel="New tax class"
          >
            New class
          </app-button>
        }
      </header>

      <div class="flex items-center gap-3 flex-wrap">
        <label for="tax-class-zone-filter" class="text-xs tracking-widest uppercase text-ink-muted">
          Filter by zone
        </label>
        <select
          id="tax-class-zone-filter"
          class="bg-surface border border-line text-ink text-sm p-2 min-w-[14rem] focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          [ngModel]="zoneIdFilter()"
          (ngModelChange)="onZoneFilterChange($event)"
          data-testid="tax-class-zone-filter"
        >
          <option value="">All zones</option>
          @for (z of zones(); track z.id) {
            <option [value]="z.id" [selected]="z.id === zoneIdFilter()">
              {{ z.name | translatable }}
            </option>
          }
        </select>
      </div>

      @if (zonesError()) {
        <app-load-error
          [message]="zonesError()!"
          [compact]="true"
          [retrying]="zonesLoading()"
          retryLabel="tax zones"
          testId="tax-zones-degraded"
          (retry)="loadZones()"
        />
      }

      <div role="alert" aria-atomic="true" data-testid="tax-classes-error">
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
              Tax classes
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
                  Zone
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
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                <tr>
                  <td colspan="4" class="px-4 py-3">
                    <div role="status" aria-busy="true" aria-label="Loading tax classes">
                      <span class="sr-only">Loading tax classes…</span>
                      @for (_ of placeholderRows; track $index) {
                        <app-skeleton height="0.75rem" />
                      }
                    </div>
                  </td>
                </tr>
              } @else if (rows().length === 0) {
                <tr>
                  <td colspan="4" class="px-4 py-16 text-center text-ink-muted text-sm">
                    No tax classes configured.
                  </td>
                </tr>
              } @else {
                @for (c of rows(); track c.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'tax-class-row-' + c.id"
                  >
                    <td class="px-4 py-3 text-sm text-ink">{{ c.name }}</td>
                    <td class="px-4 py-3 text-xs text-ink-muted">{{ zoneName(c.zoneId) }}</td>
                    <td class="px-4 py-3 text-sm text-ink font-mono tabular-nums">
                      {{ formatRate(c.rate) }}
                    </td>
                    <td class="px-4 py-3">
                      @if (c.isDefault) {
                        <app-badge tone="info" [ariaLabel]="'Default class in its zone'">
                          Default
                        </app-badge>
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
        testIdPrefix="tax-classes"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class TaxClassesListPage implements OnInit, OnDestroy {
  private readonly tax = inject(TaxService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly TaxClass[]>([]);
  readonly total = signal(0);
  readonly zones = signal<readonly TaxZone[]>([]);
  readonly zonesError = signal<string | null>(null);
  readonly zonesLoading = signal(false);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly zoneIdFilter = computed(() => this.queryParams()['zoneId'] ?? '');
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  ngOnInit(): void {
    this.loadZones();
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onZoneFilterChange(zoneId: string): void {
    const params: Record<string, string | null> = {
      zoneId: zoneId || null,
      page: null,
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
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

  zoneName(zoneId: string): string {
    const match = this.zones().find((z) => z.id === zoneId);
    if (!match) return '—';
    const resolved = pickTranslation(
      match.name,
      this.authStore.locale(),
      '',
      this.storeSettings.defaultLocale(),
    );
    return resolved.length > 0 ? resolved : '—';
  }

  formatRate(rate: number): string {
    const pct = rate * 100;
    return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
  }

  loadZones(): void {
    this.zonesLoading.set(true);
    this.tax
      .listZones({ page: 1, pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.zones.set(res.data);
          this.zonesError.set(null);
          this.zonesLoading.set(false);
        },
        error: () => {
          this.zones.set([]);
          this.zonesError.set('Could not load tax zones. The zone filter stays empty.');
          this.zonesLoading.set(false);
        },
      });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    const query: { page: number; pageSize: number; zoneId?: string } = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    const zoneId = this.zoneIdFilter();
    if (zoneId) query.zoneId = zoneId;
    this.tax
      .listClasses(query)
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view tax classes.';
    if (err instanceof ApiNotFoundError) return 'Tax classes not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load tax classes.';
  }
}
