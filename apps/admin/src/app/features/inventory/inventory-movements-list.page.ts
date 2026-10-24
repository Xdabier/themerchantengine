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
  InventoryService,
  type ListMovementsQuery,
  type MovementType,
  type StockMovement,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import {
  movementTypeLabel,
  movementTypes,
  reasonLabel,
  signedQuantityColor,
} from './inventory.utils';
import { pickTranslation, type Translatable } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

@Component({
  selector: 'app-inventory-movements-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, SkeletonComponent, AdminDatePipe, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="inventory-movements-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Movements</h1>
          <p class="mt-3 text-ink-muted text-sm">Immutable log of every stock mutation.</p>
        </div>
      </header>

      <nav class="flex items-center gap-4 flex-wrap text-xs tabular" aria-label="Inventory pages">
        <a
          routerLink="/inventory"
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Stock</a
        >
        <a
          routerLink="/inventory/alerts"
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Alerts</a
        >
        <a
          routerLink="/inventory/movements"
          class="text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Movements</a
        >
        <a
          routerLink="/inventory/locations"
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Locations</a
        >
      </nav>

      <div
        class="flex items-center gap-3 flex-wrap"
        role="group"
        aria-label="Filter movements by type"
      >
        <span class="text-xs tracking-widest uppercase text-ink-muted">Type</span>
        <button
          type="button"
          class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          [class.border-ink]="type() === null"
          [class.text-ink]="type() === null"
          [class.border-line]="type() !== null"
          [class.text-ink-muted]="type() !== null"
          [attr.aria-pressed]="type() === null"
          [attr.data-testid]="'movement-filter-all'"
          (click)="setType(null)"
        >
          All
        </button>
        @for (t of types; track t) {
          <button
            type="button"
            class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="type() === t"
            [class.text-ink]="type() === t"
            [class.border-line]="type() !== t"
            [class.text-ink-muted]="type() !== t"
            [attr.aria-pressed]="type() === t"
            [attr.data-testid]="'movement-filter-' + t"
            (click)="setType(t)"
          >
            {{ movementTypeLabel(t) }}
          </button>
        }
      </div>

      @if (error()) {
        <p class="border border-status-error text-ink p-3 tabular text-xs" role="alert">
          {{ error() }}
        </p>
      }

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Stock movement log
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  When
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
                  Qty
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Reason
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
                    No movements logged for the current filter.
                  </td>
                </tr>
              } @else {
                @for (row of rows(); track row.id) {
                  <tr
                    class="border-b border-line last:border-b-0"
                    [attr.data-testid]="'movement-row-' + row.id"
                  >
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ row.createdAt | adminDate }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge tone="neutral">{{ movementTypeLabel(row.type) }}</app-badge>
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink">
                      {{ row.variant?.sku ?? row.variantId }}
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
                    <td
                      class="px-4 py-3 tabular-nums text-sm font-bold"
                      [class]="quantityClass(row.quantity)"
                    >
                      {{ row.quantity > 0 ? '+' + row.quantity : row.quantity }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ reasonLabel(row.reason) }}
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
        testIdPrefix="inventory-movements"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class InventoryMovementsPage implements OnInit, OnDestroy {
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly inventoryService = inject(InventoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly types = movementTypes;
  protected readonly movementTypeLabel = movementTypeLabel;
  protected readonly reasonLabel = reasonLabel;
  protected readonly quantityClass = signedQuantityColor;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly StockMovement[]>([]);
  readonly total = signal(0);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly type = computed(() => (this.queryParams()['type'] as MovementType | undefined) ?? null);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setType(value: MovementType | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { type: value, page: 1 },
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

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    const query: ListMovementsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
      ...(this.type() ? { type: this.type()! } : {}),
    };
    this.inventoryService
      .listMovements(query)
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view movements.';
    if (err instanceof ApiNotFoundError) return 'Movements not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load movements. Please retry.';
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
