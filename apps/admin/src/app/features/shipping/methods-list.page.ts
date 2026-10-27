import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
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
import { ApiError, ApiForbiddenError } from '@admin-types';
import { ShippingService, type ShippingMethod, type ShippingZone } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  METHOD_TYPE_LABELS,
  freeAboveSummary,
  methodPriceSummary,
  methodTypeBadgeTone,
  translatableDefault,
} from './shipping.utils';
import { CurrencyStore } from '../../core/stores/currency.store';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

@Component({
  selector: 'app-shipping-methods-list-page',
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
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="shipping-methods-list-page">
      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Shipping methods</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Each method belongs to a zone. Types: flat rate, weight-based, price-based, carrier
            calculated, or free.
          </p>
        </div>
        @if (canCreate()) {
          <a
            routerLink="/shipping/methods/new"
            class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
            data-testid="methods-new-cta"
          >
            Create method
          </a>
        }
      </header>

      <div class="flex items-end gap-3 flex-wrap">
        <label
          for="methods-zone-filter"
          class="flex flex-col gap-1 text-xs tracking-widest uppercase text-ink-muted"
        >
          <span>Zone</span>
          <select
            id="methods-zone-filter"
            class="min-h-[44px] min-w-[16rem] px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [value]="zoneFilter() ?? ''"
            (change)="onZoneFilter($any($event.target).value)"
            data-testid="methods-zone-filter"
          >
            <option value="">All zones</option>
            @for (z of zones(); track z.id) {
              <option [value]="z.id" [selected]="z.id === zoneFilter()">{{ zoneName(z) }}</option>
            }
          </select>
        </label>
      </div>

      @if (zonesError()) {
        <app-load-error
          [message]="zonesError()!"
          [compact]="true"
          [retrying]="zonesLoading()"
          retryLabel="zones"
          testId="methods-zones-degraded"
          (retry)="fetchZones()"
        />
      }

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="methods-error"
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
              Shipping methods
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
                  Type
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Price
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Free above
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Sort
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
                    @for (__ of [0, 1, 2, 3, 4, 5, 6, 7]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    colspan="8"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="methods-empty"
                  >
                    No shipping methods configured.
                  </td>
                </tr>
              } @else {
                @for (m of rows(); track m.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'method-row-' + m.id"
                  >
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2 flex-wrap">
                        <a
                          [routerLink]="['/shipping/methods', m.id]"
                          class="text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                        >
                          {{ methodName(m) }}
                        </a>
                        @if (m.isDefault) {
                          <app-badge tone="info" [ariaLabel]="'Default method'">
                            Default
                          </app-badge>
                        }
                      </div>
                    </td>
                    <td
                      class="px-4 py-3 text-sm text-ink-muted"
                      [attr.data-testid]="'method-zone-' + m.id"
                    >
                      {{ zoneDisplay(m) }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="methodTypeBadgeTone(m.type)"
                        [ariaLabel]="typeLabels[m.type]"
                      >
                        {{ typeLabels[m.type] }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ methodPriceSummary(m, storeCurrency()) }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ freeAboveSummary(m.freeAbove, storeCurrency()) }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ m.sortOrder }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="m.isActive ? 'success' : 'warning'"
                        [ariaLabel]="m.isActive ? 'Active method' : 'Disabled method'"
                      >
                        {{ m.isActive ? 'Active' : 'Disabled' }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ m.updatedAt | adminDate }}
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
        testIdPrefix="methods"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class ShippingMethodsListPage implements OnInit, OnDestroy {
  private readonly shipping = inject(ShippingService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  private readonly currencyStore = inject(CurrencyStore);
  protected readonly storeCurrency = this.currencyStore.config;
  protected readonly methodPriceSummary = methodPriceSummary;
  protected readonly freeAboveSummary = freeAboveSummary;
  protected readonly methodTypeBadgeTone = methodTypeBadgeTone;
  protected readonly typeLabels = METHOD_TYPE_LABELS;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly ShippingMethod[]>([]);
  readonly total = signal(0);
  readonly zones = signal<readonly ShippingZone[]>([]);
  readonly zonesError = signal<string | null>(null);
  readonly zonesLoading = signal(false);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly zoneFilter = computed<string | null>(() => this.queryParams()['zoneId'] ?? null);

  readonly canCreate = computed(() => this.auth.hasPermission('shipping:create'));

  constructor() {
    effect(() => {
      this.queryParams();
      this.fetch();
    });
  }

  ngOnInit(): void {
    this.fetchZones();
  }

  /** Zone names label every method row; without them the column reads blank. */
  fetchZones(): void {
    this.zonesLoading.set(true);
    this.shipping
      .listZones({ pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.zones.set(res.data);
          this.zonesError.set(null);
          this.zonesLoading.set(false);
        },
        error: () => {
          this.zones.set([]);
          this.zonesError.set('Could not load zones. Method rows cannot name their zone.');
          this.zonesLoading.set(false);
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  zoneName(z: ShippingZone): string {
    return translatableDefault(z.name) || '(untitled)';
  }

  zoneLookup(id: string): string {
    const match = this.zones().find((z) => z.id === id);
    return match ? this.zoneName(match) : '—';
  }

  /**
   * The zone a method belongs to. `listMethods` already includes
   * `zone { id, name }` on every row, so this needs no lookup and no second
   * fetch; the client-side join against a `pageSize: 100` zone page was what
   * made real zones fall outside page one and dash (finding F8). The lookup
   * stays as a fallback and still feeds the zone filter select.
   */
  zoneDisplay(m: ShippingMethod): string {
    return translatableDefault(m.zone?.name) || this.zoneLookup(m.zoneId);
  }

  methodName(m: ShippingMethod): string {
    return translatableDefault(m.name) || '(untitled)';
  }

  onZoneFilter(value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { zoneId: value || null, page: null },
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

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    const query: {
      page: number;
      pageSize: number;
      zoneId?: string;
    } = { page: this.page(), pageSize: this.pageSize() };
    const filter = this.zoneFilter();
    if (filter) query.zoneId = filter;
    this.shipping
      .listMethods(query)
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
      return 'You do not have permission to view shipping methods.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load shipping methods. Please retry.';
  }
}
