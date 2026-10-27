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
import {
  CarriersService,
  type Carrier,
  type CarrierProvider,
  type ListCarriersQuery,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

function providerLabel(p: string): string {
  switch (p) {
    case 'dhl':
      return 'DHL';
    case 'fedex':
      return 'FedEx';
    case 'ups':
      return 'UPS';
    case 'aramex':
      return 'Aramex';
    case 'manual':
      return 'Manual';
    default:
      return p;
  }
}

function carrierLabel(
  c: Pick<Carrier, 'name' | 'code'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    c.name as Translatable | string | null | undefined,
    locale,
    c.code,
    defaultLocale,
  );
}

/**
 * `/shipping/carriers` — carrier catalogue. Provider integrations are
 * operator-configured; the runtime is pluggable per the spec.
 */
@Component({
  selector: 'app-carriers-list-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, SkeletonComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="carriers-list-page">
      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Shipping</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Carriers</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Shipping providers with configured services + zones. Runtime integrations are pluggable
            per provider.
          </p>
        </div>
        @if (canCreate()) {
          <a
            routerLink="/shipping/carriers/new"
            class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
            data-testid="carriers-new-cta"
          >
            New carrier
          </a>
        }
      </header>

      <div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by provider">
        @for (opt of providerOptions; track opt.value) {
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 min-h-[44px] border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="providerFilter() === opt.value"
            [class.text-ink]="providerFilter() === opt.value"
            [class.border-line]="providerFilter() !== opt.value"
            [class.text-ink-muted]="providerFilter() !== opt.value"
            [attr.aria-pressed]="providerFilter() === opt.value"
            [attr.data-testid]="'carrier-provider-' + (opt.value ?? 'all')"
            (click)="setProvider(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="carriers-error">
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
              Carriers
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
                  Provider
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Services
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Zones
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
                    No carriers configured.
                  </td>
                </tr>
              } @else {
                @for (c of rows(); track c.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'carrier-row-' + c.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/shipping/carriers', c.id]"
                        class="text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ label(c) }}
                      </a>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted">
                      {{ providerLabel(c.provider) }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted">
                      {{ truncateList(c.services) }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted">
                      {{ c.zones.length === 0 ? 'Any' : truncateList(c.zones) }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="c.isActive ? 'success' : 'neutral'"
                        [ariaLabel]="c.isActive ? 'Active' : 'Disabled'"
                      >
                        {{ c.isActive ? 'Active' : 'Disabled' }}
                      </app-badge>
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
        testIdPrefix="carriers"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class CarriersListPage implements OnInit, OnDestroy {
  private readonly service = inject(CarriersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Carrier[]>([]);
  readonly total = signal(0);

  readonly canCreate = computed(() => this.auth.hasPermission('carriers:create'));

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly providerFilter = computed<CarrierProvider | null>(() => {
    const raw = this.queryParams()['provider'];
    const known = ['dhl', 'fedex', 'ups', 'aramex', 'manual'];
    return known.includes(raw ?? '') ? (raw as CarrierProvider) : null;
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly providerOptions: ReadonlyArray<{ value: CarrierProvider | null; label: string }> = [
    { value: null, label: 'All' },
    { value: 'dhl', label: 'DHL' },
    { value: 'fedex', label: 'FedEx' },
    { value: 'ups', label: 'UPS' },
    { value: 'aramex', label: 'Aramex' },
    { value: 'manual', label: 'Manual' },
  ];

  protected readonly label = (c: Pick<Carrier, 'name' | 'code'>): string =>
    carrierLabel(c, this.auth.locale(), this.storeSettings.defaultLocale());
  protected readonly providerLabel = providerLabel;

  truncateList(list: readonly string[]): string {
    if (!list || list.length === 0) return '—';
    if (list.length <= 4) return list.join(', ');
    return `${list.slice(0, 4).join(', ')} +${list.length - 4}`;
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setProvider(value: CarrierProvider | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { provider: value, page: null },
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
    const query: ListCarriersQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    if (this.providerFilter()) query.provider = this.providerFilter() as CarrierProvider;

    this.loading.set(true);
    this.error.set(null);
    this.service
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view carriers.';
    if (err instanceof ApiNotFoundError) return 'Carriers not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load carriers.';
  }
}
