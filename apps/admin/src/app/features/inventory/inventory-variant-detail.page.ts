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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, SkeletonComponent } from '@admin-ui';
import { InventoryService, type VariantStockDetail } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, pickTranslation } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { openAdjustDialog } from './inventory-adjust-dialog.component';
import { stockStatusTone } from './inventory.utils';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

@Component({
  selector: 'app-inventory-variant-detail-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="inventory-variant-detail-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/inventory"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Inventory
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        @if (product(); as p) {
          <a
            [routerLink]="['/products', p.id]"
            class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            data-testid="variant-product-link"
          >
            {{ productName() }}
          </a>
          <span aria-hidden="true" class="mx-2">/</span>
        }
        <span class="text-ink" aria-current="page" [title]="variantId()">{{ variantLabel() }}</span>
      </nav>

      @if (error()) {
        <p class="border border-status-error text-ink p-3 tabular text-xs" role="alert">
          {{ error() }}
        </p>
      }

      @if (loading()) {
        <app-skeleton height="2.5rem" width="40%" />
        <app-skeleton height="12rem" width="100%" />
      } @else {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p class="text-xs tracking-widest uppercase text-ink-muted">Variant</p>
            <h1
              class="mt-2 text-4xl md:text-5xl font-bold tracking-tight tabular"
              [title]="variantId()"
            >
              {{ variantLabel() }}
            </h1>
          </div>
          @if (product(); as p) {
            <app-button
              variant="secondary"
              size="sm"
              [routerLink]="['/products', p.id]"
              testId="variant-open-product"
              [ariaLabel]="'Open ' + productName()"
            >
              Open product
            </app-button>
          }
        </header>

        <div class="border border-line bg-surface">
          <table class="w-full border-collapse">
            <caption class="sr-only">
              Per-location stock breakdown
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
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
                  Available
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Active
                </th>
                @if (canUpdate()) {
                  <th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>
                }
              </tr>
            </thead>
            <tbody>
              @if (levels().length === 0) {
                <tr>
                  <td
                    colspan="6"
                    class="px-4 py-16 text-center text-ink-muted tabular text-sm"
                    data-testid="variant-empty"
                  >
                    No stock recorded for this variant yet.
                  </td>
                </tr>
              } @else {
                @for (row of levels(); track row.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'variant-level-' + row.locationId"
                  >
                    <td class="px-4 py-3 tabular text-sm text-ink">
                      {{ row.location.name }} · {{ row.location.code }}
                    </td>
                    <td class="px-4 py-3 tabular-nums text-sm text-ink">
                      {{ row.onHand }}
                    </td>
                    <td class="px-4 py-3 tabular-nums text-sm text-ink-muted">
                      {{ row.reserved }}
                    </td>
                    <td class="px-4 py-3 tabular-nums text-sm text-ink">
                      {{ row.available }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge [tone]="row.location.isActive ? 'success' : 'neutral'">
                        {{ row.location.isActive ? 'Active' : 'Inactive' }}
                      </app-badge>
                    </td>
                    @if (canUpdate()) {
                      <td class="px-4 py-3 text-right">
                        <app-button
                          variant="secondary"
                          size="sm"
                          (clicked)="openAdjust(row.locationId)"
                          [attr.data-testid]="'variant-adjust-' + row.locationId"
                          [attr.aria-label]="'Adjust stock at ' + row.location.name"
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
      }
    </section>
  `,
})
export class InventoryVariantDetailPage implements OnInit, OnDestroy {
  private readonly inventoryService = inject(InventoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(Dialog);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly statusTone = stockStatusTone;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly variantId = signal<string>('');
  readonly detail = signal<VariantStockDetail | null>(null);
  readonly levels = computed(() => this.detail()?.levels ?? []);
  /**
   * The product this variant belongs to. Available even when the variant has
   * no stock rows at all, which is the case the old bare-array response could
   * not express and is exactly when an operator wants the product.
   */
  readonly product = computed(() => this.detail()?.variant?.product ?? null);
  readonly canUpdate = computed(() => this.authStore.hasPermission('inventory:update'));

  /**
   * Readable variant identity — "Product name · SKU" resolved from the joined
   * variant on the first stock row. Falls back to the SKU, then the raw variant
   * id (e.g. a variant with no stock-level rows yet).
   */
  protected variantLabel(): string {
    const variant = this.detail()?.variant;
    if (!variant) return this.variantId();
    const name = pickTranslation(
      variant.product?.name,
      this.authStore.locale(),
      '',
      this.storeSettings.defaultLocale(),
    );
    if (name && variant.sku) return `${name} · ${variant.sku}`;
    return name || variant.sku || this.variantId();
  }

  protected productName(): string {
    const product = this.product();
    return product
      ? pickTranslation(
          product.name,
          this.authStore.locale(),
          product.id,
          this.storeSettings.defaultLocale(),
        )
      : '';
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('variantId');
      if (!id) {
        this.error.set('Missing variant id.');
        this.loading.set(false);
        return;
      }
      this.variantId.set(id);
      this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async openAdjust(locationId: string): Promise<void> {
    const saved = await openAdjustDialog(this.dialog, {
      variantId: this.variantId(),
      locationId,
    });
    if (saved) this.fetch(this.variantId());
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.inventoryService
      .getVariantStock(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiNotFoundError) return 'Variant not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view this variant.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load variant stock. Please retry.';
  }
}
