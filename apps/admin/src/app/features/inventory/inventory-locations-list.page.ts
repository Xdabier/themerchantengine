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
import { RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, SkeletonComponent, openConfirmDialog } from '@admin-ui';
import { InventoryService, type InventoryLocation } from '@admin-services';
import {
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  ApiValidationError,
} from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { openLocationDialog } from './inventory-location-dialog.component';

@Component({
  selector: 'app-inventory-locations-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="inventory-locations-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Locations</h1>
          <p class="mt-3 text-ink-muted text-sm">Warehouses, stores, and 3PL partners.</p>
        </div>
        @if (canCreate()) {
          <app-button
            variant="primary"
            size="md"
            (clicked)="openCreate()"
            data-testid="location-create-open"
          >
            New location
          </app-button>
        }
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
          class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Movements</a
        >
        <a
          routerLink="/inventory/locations"
          class="text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
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
            Inventory locations
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
                Code
              </th>
              <th
                scope="col"
                class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
              >
                Active
              </th>
              <th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @if (loading()) {
              @for (_ of skeletonRows; track $index) {
                <tr class="border-b border-line">
                  @for (__ of [0, 1, 2, 3]; track $index) {
                    <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                  }
                </tr>
              }
            } @else if (rows().length === 0) {
              <tr>
                <td colspan="4" class="px-4 py-16 text-center text-ink-muted tabular text-sm">
                  No locations configured yet.
                </td>
              </tr>
            } @else {
              @for (row of rows(); track row.id) {
                <tr
                  class="border-b border-line last:border-b-0"
                  [attr.data-testid]="'location-row-' + row.code"
                >
                  <td class="px-4 py-3 tabular text-sm text-ink">{{ row.name }}</td>
                  <td class="px-4 py-3 tabular text-sm text-ink-muted">{{ row.code }}</td>
                  <td class="px-4 py-3">
                    <app-badge [tone]="row.isActive ? 'success' : 'neutral'">
                      {{ row.isActive ? 'Active' : 'Inactive' }}
                    </app-badge>
                  </td>
                  <td class="px-4 py-3 text-right">
                    @if (canUpdate()) {
                      <app-button
                        variant="secondary"
                        size="sm"
                        (clicked)="openEdit(row)"
                        [attr.data-testid]="'location-edit-' + row.code"
                        [attr.aria-label]="'Edit ' + row.name"
                      >
                        Edit
                      </app-button>
                    }
                    @if (canDelete()) {
                      <app-button
                        variant="destructive"
                        size="sm"
                        (clicked)="remove(row)"
                        [attr.data-testid]="'location-delete-' + row.code"
                        [attr.aria-label]="'Delete ' + row.name"
                      >
                        Delete
                      </app-button>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class InventoryLocationsPage implements OnInit, OnDestroy {
  private readonly inventoryService = inject(InventoryService);
  private readonly dialog = inject(Dialog);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly InventoryLocation[]>([]);

  readonly canCreate = computed(() => this.authStore.hasPermission('inventory:create'));
  readonly canUpdate = computed(() => this.authStore.hasPermission('inventory:update'));
  readonly canDelete = computed(() => this.authStore.hasPermission('inventory:delete'));

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async openCreate(): Promise<void> {
    const created = await openLocationDialog(this.dialog, {});
    if (created) this.fetch();
  }

  async openEdit(row: InventoryLocation): Promise<void> {
    const updated = await openLocationDialog(this.dialog, { location: row });
    if (updated) this.fetch();
  }

  async remove(row: InventoryLocation): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete location',
      body: `Remove "${row.name}"? Blocked if this location still holds stock.`,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.inventoryService
      .deleteLocation(row.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.fetch(),
        error: (err: unknown) => this.error.set(this.formatError(err)),
      });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.inventoryService
      .listLocations({ page: 1, pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiValidationError || err instanceof ApiConflictError)
      return 'Cannot delete a location that still holds stock.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage locations.';
    if (err instanceof ApiNotFoundError) return 'Location not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not update locations. Please retry.';
  }
}
