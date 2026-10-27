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
  LoadErrorComponent,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import {
  InventoryService,
  type InventoryLocation,
  type StockLevel,
  type StockStatus,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { pickTranslation, type Translatable } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { openAdjustDialog } from './inventory-adjust-dialog.component';
import { openTransferDialog } from './inventory-transfer-dialog.component';
import { stockStatusLabel, stockStatusTone } from './inventory.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

type StatusOption = { value: StockStatus | null; label: string };

@Component({
  selector: 'app-inventory-stock-list-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    LoadErrorComponent,
    SkeletonComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="inventory-stock-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Inventory</h1>
          <p class="mt-3 text-ink-muted text-sm">
            Stock levels across warehouses, stores, and 3PL partners.
          </p>
        </div>
        @if (canUpdate()) {
          <div class="flex items-center gap-2 flex-wrap">
            <app-button
              variant="secondary"
              size="md"
              (clicked)="openAdjust()"
              data-testid="inventory-adjust-open"
            >
              Adjust
            </app-button>
            <app-button
              variant="primary"
              size="md"
              (clicked)="openTransfer()"
              data-testid="inventory-transfer-open"
            >
              Transfer
            </app-button>
          </div>
        }
      </header>

      <nav class="flex items-center gap-4 flex-wrap text-xs tabular" aria-label="Inventory pages">
        <a
          routerLink="/inventory"
          class="text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Stock</a
        >
        <a
          routerLink="/inventory/alerts"
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="inventory-alerts-link"
          >Alerts</a
        >
        <a
          routerLink="/inventory/movements"
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="inventory-movements-link"
          >Movements</a
        >
        <a
          routerLink="/inventory/locations"
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="inventory-locations-link"
          >Locations</a
        >
      </nav>

      <div
        class="flex items-center gap-3 flex-wrap"
        role="group"
        aria-label="Filter stock by status"
      >
        <span class="text-xs tracking-widest uppercase text-ink-muted">Status</span>
        @for (opt of statusOptions; track opt.value) {
          <button
            type="button"
            class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="stockStatus() === opt.value"
            [class.text-ink]="stockStatus() === opt.value"
            [class.border-line]="stockStatus() !== opt.value"
            [class.text-ink-muted]="stockStatus() !== opt.value"
            [attr.aria-pressed]="stockStatus() === opt.value"
            [attr.data-testid]="'stock-filter-' + (opt.value ?? 'all')"
            (click)="setStatus(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      @if (locationsError()) {
        <app-load-error
          [message]="locationsError()!"
          [compact]="true"
          [retrying]="locationsLoading()"
          retryLabel="locations"
          testId="inventory-locations-degraded"
          (retry)="fetchLocations()"
        />
      }

      @if (error()) {
        <app-load-error
          [message]="error()!"
          [retrying]="loading()"
          retryLabel="stock levels"
          testId="inventory-error"
          (retry)="reload()"
        />
      }

      <div class="border border-line bg-surface" data-testid="inventory-table">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Stock levels
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Variant
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Location
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  On hand
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Reserved
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
                  <td colspan="6" class="px-4 py-16 text-center text-ink-muted tabular text-sm">
                    No stock levels match the current filter.
                  </td>
                </tr>
              } @else {
                @for (row of rows(); track row.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'stock-row-' + row.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/inventory/variants', row.variantId]"
                        class="tabular text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ row.variant?.sku ?? row.variantId }}
                      </a>
                      @if (productLink(row); as p) {
                        <a
                          [routerLink]="['/products', p.id]"
                          class="block tabular text-xs text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                          [attr.data-testid]="'row-product-link-' + row.id"
                        >
                          {{ p.label }}
                        </a>
                      }
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ row.location?.name ?? row.locationId }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink tabular-nums">
                      {{ row.onHand }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted tabular-nums">
                      {{ row.reserved ?? 0 }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(row.status)"
                        [ariaLabel]="
                          row.status
                            ? 'Stock status: ' + stockStatusLabel(row.status)
                            : 'Stock status: not reported'
                        "
                        [attr.data-testid]="'stock-status-' + row.id"
                      >
                        {{ stockStatusLabel(row.status) }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 tabular tabular-nums text-sm text-ink-muted">
                      {{ row.updatedAt | adminDate }}
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
        testIdPrefix="inventory"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class InventoryStockListPage implements OnInit, OnDestroy {
  private readonly inventoryService = inject(InventoryService);
  private readonly dialog = inject(Dialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];
  protected readonly statusTone = stockStatusTone;
  protected readonly stockStatusLabel = stockStatusLabel;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly StockLevel[]>([]);
  readonly total = signal(0);
  readonly locations = signal<readonly InventoryLocation[]>([]);
  readonly locationsError = signal<string | null>(null);
  readonly locationsLoading = signal(false);

  readonly canUpdate = computed(() => this.authStore.hasPermission('inventory:update'));

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly stockStatus = computed(
    () => (this.queryParams()['stockStatus'] as StockStatus | undefined) ?? null,
  );
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly statusOptions: readonly StatusOption[] = [
    { value: null, label: 'All' },
    { value: 'IN_STOCK', label: 'In stock' },
    { value: 'LOW_STOCK', label: 'Low' },
    { value: 'OUT_OF_STOCK', label: 'Out' },
  ];

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
    this.fetchLocations();
  }

  /**
   * Adjust and Transfer both hand this list to their dialogs, so a silent
   * failure used to leave the operator picking from an empty location list
   * with nothing on screen admitting why.
   */
  fetchLocations(): void {
    this.locationsLoading.set(true);
    this.inventoryService
      .listLocations({ page: 1, pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.locations.set(res.data);
          this.locationsError.set(null);
          this.locationsLoading.set(false);
        },
        error: () => {
          this.locations.set([]);
          this.locationsError.set('Could not load locations. Adjust and Transfer need them.');
          this.locationsLoading.set(false);
        },
      });
  }

  /** Re-fire the stock fetch after a failure, without a full page reload. */
  reload(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setStatus(value: StockStatus | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { stockStatus: value, page: 1 },
      queryParamsHandling: 'merge',
    });
  }

  goToPage(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  async openAdjust(): Promise<void> {
    const saved = await openAdjustDialog(this.dialog, { locations: this.locations() });
    if (saved) this.fetch();
  }

  async openTransfer(): Promise<void> {
    const saved = await openTransferDialog(this.dialog, { locations: this.locations() });
    if (saved) this.fetch();
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    const query = {
      page: this.page(),
      pageSize: this.pageSize(),
      ...(this.stockStatus() ? { stockStatus: this.stockStatus()! } : {}),
    };
    this.inventoryService
      .listStockLevels(query)
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view inventory.';
    if (err instanceof ApiNotFoundError) return 'Stock levels not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load stock levels. Please retry.';
  }

  /**
   * The product a row belongs to, resolved for display.
   *
   * Returns null rather than a placeholder when the join is absent, so the
   * template renders no link at all: a link labelled with a raw id is worse
   * than none. Resolved through `pickTranslation` because admin reads are
   * unresolved, and binding a Translatable directly is the defect the
   * entity-rendering guard exists to catch.
   */
  protected productLink(row: {
    variant?: { productId?: string; product?: { id: string; name: unknown } | null } | null;
  }): { id: string; label: string } | null {
    const product = row.variant?.product;
    if (!product) return null;
    const label = pickTranslation(
      product.name as Translatable | string | null | undefined,
      this.authStore.locale(),
      product.id,
      this.storeSettings.defaultLocale(),
    );
    return { id: product.id, label };
  }
}
