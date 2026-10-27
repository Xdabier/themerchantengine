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
import { BadgeComponent, ButtonComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import { InventoryService, type InventoryAlert } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { openAdjustDialog } from './inventory-adjust-dialog.component';
import { alertTypeLabel, alertTypeTone } from './inventory.utils';

@Component({
  selector: 'app-inventory-alerts-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="inventory-alerts-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Alerts</h1>
          <p class="mt-3 text-ink-muted text-sm">Variants at or below the low-stock threshold.</p>
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
          class="text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Alerts</a
        >
        <a
          routerLink="/inventory/movements"
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Movements</a
        >
        <a
          routerLink="/inventory/locations"
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Locations</a
        >
      </nav>

      @if (error()) {
        <p class="border border-status-error text-ink p-3 tabular text-xs" role="alert">
          {{ error() }}
        </p>
      }

      <div class="border border-line bg-surface">
        <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
          <caption class="sr-only">
            Low-stock and out-of-stock alerts
          </caption>
          <thead class="border-b border-line">
            <tr class="text-left">
              <th
                scope="col"
                class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
              >
                Severity
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
                On hand
              </th>
              <th
                scope="col"
                class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
              >
                Threshold
              </th>
              @if (canUpdate()) {
                <th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @if (loading()) {
              @for (_ of skeletonRows; track $index) {
                <tr class="border-b border-line">
                  @for (__ of [0, 1, 2, 3, 4]; track $index) {
                    <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                  }
                </tr>
              }
            } @else if (rows().length === 0) {
              <tr>
                <td
                  colspan="6"
                  class="px-4 py-16 text-center text-ink-muted tabular text-sm"
                  data-testid="alerts-empty"
                >
                  All clear — no low-stock or out-of-stock alerts.
                </td>
              </tr>
            } @else {
              @for (row of rows(); track row.id) {
                <tr
                  class="border-b border-line last:border-b-0 hover:bg-surface-elevated"
                  [attr.data-testid]="'alert-row-' + row.id"
                >
                  <td class="px-4 py-3">
                    <app-badge [tone]="alertTypeTone(row.alertType)">{{
                      alertTypeLabel(row.alertType)
                    }}</app-badge>
                  </td>
                  <td class="px-4 py-3 tabular text-sm text-ink">
                    <a
                      [routerLink]="['/inventory/variants', row.variantId]"
                      class="hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                    >
                      {{ row.variant?.sku ?? row.variantId }}
                    </a>
                  </td>
                  <td class="px-4 py-3 tabular text-sm text-ink-muted">
                    {{ row.location?.name ?? row.locationId }}
                  </td>
                  <td class="px-4 py-3 tabular-nums text-sm text-ink">{{ row.onHand }}</td>
                  <td class="px-4 py-3 tabular-nums text-sm text-ink-muted">
                    {{ row.lowStockThreshold ?? '—' }}
                  </td>
                  @if (canUpdate()) {
                    <td class="px-4 py-3 text-right">
                      <app-button
                        variant="secondary"
                        size="sm"
                        (clicked)="openAdjust(row)"
                        [attr.aria-label]="
                          'Adjust stock for ' + (row.variant?.sku ?? row.variantId)
                        "
                      >
                        Adjust
                      </app-button>
                    </td>
                  }
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <app-pagination
        [page]="page()"
        [pageSize]="pageSize()"
        [total]="total()"
        [loading]="loading()"
        testIdPrefix="inventory-alerts"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class InventoryAlertsPage implements OnInit, OnDestroy {
  private readonly inventoryService = inject(InventoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(Dialog);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly alertTypeTone = alertTypeTone;
  protected readonly alertTypeLabel = alertTypeLabel;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly InventoryAlert[]>([]);
  readonly total = signal(0);
  readonly canUpdate = computed(() => this.authStore.hasPermission('inventory:update'));

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
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  async openAdjust(alert: InventoryAlert): Promise<void> {
    const saved = await openAdjustDialog(this.dialog, {
      variantId: alert.variantId,
      locationId: alert.locationId,
      currentOnHand: alert.onHand,
    });
    if (saved) this.fetch();
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.inventoryService
      .listAlerts({ page: this.page(), pageSize: this.pageSize() })
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view alerts.';
    if (err instanceof ApiNotFoundError) return 'Alerts not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load alerts. Please retry.';
  }
}
