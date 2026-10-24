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
  CheckboxComponent,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import {
  ProductsService,
  productStatusSchema,
  type ListProductsQuery,
  type Product,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  BulkPricesDialogComponent,
  type BulkPriceRow,
  type BulkPricesDialogData,
  type BulkPricesDialogResult,
} from './bulk-prices.dialog';
import {
  BulkStatusDialogComponent,
  type BulkStatusDialogData,
  type BulkStatusDialogResult,
} from './bulk-status.dialog';
import {
  SEO_SUBMIT_DIALOG_DESC_ID,
  SEO_SUBMIT_DIALOG_TITLE_ID,
  SeoSubmitDialogComponent,
  type SeoSubmitDialogData,
  type SeoSubmitDialogResult,
  summarizeSeoSubmit,
} from '../seo/seo-submit.dialog';
import { defaultVariantFor, pickTranslatable, productStatusTone } from './products.utils';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

@Component({
  selector: 'app-products-list-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    CheckboxComponent,
    SkeletonComponent,
    MoneyPipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="products-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Catalog</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Products</h1>
        </div>
        <div class="flex items-center gap-4 flex-wrap">
          <div class="min-w-64 max-w-md flex-1" role="search">
            <label for="products-search" class="sr-only">Search products</label>
            <input
              id="products-search"
              type="search"
              inputmode="search"
              autocomplete="off"
              class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line placeholder:text-ink-muted focus:outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              placeholder="Search by name, SKU, slug, or brand…"
              [value]="search() ?? ''"
              (input)="onSearch($event)"
              data-testid="products-search"
            />
          </div>
          <div
            class="flex items-center gap-2 flex-wrap"
            role="group"
            aria-label="Filter products by status"
          >
            <span class="text-xs tracking-widest uppercase text-ink-muted">Status</span>
            @for (opt of statusOptions; track opt.value) {
              <button
                type="button"
                class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                [class.border-ink]="status() === opt.value"
                [class.text-ink]="status() === opt.value"
                [class.border-line]="status() !== opt.value"
                [class.text-ink-muted]="status() !== opt.value"
                [attr.aria-pressed]="status() === opt.value"
                [attr.data-testid]="'product-status-filter-' + (opt.value ?? 'all')"
                (click)="setStatus(opt.value)"
              >
                {{ opt.label }}
              </button>
            }
          </div>
          @if (canCreate()) {
            <a
              routerLink="/products/new"
              class="inline-flex items-center justify-center min-h-[44px] px-4 text-xs tracking-widest uppercase border border-ink text-ink hover:bg-surface-emphasis hover:text-on-emphasis motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="products-list-create-cta"
            >
              New product
            </a>
          }
        </div>
      </header>

      <p
        class="text-sm text-ink min-h-[1.5rem]"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="products-bulk-announcer"
      >
        {{ announcement() || ' ' }}
      </p>

      @if (error()) {
        <p
          class="border border-status-error text-ink p-3 tabular text-xs"
          data-testid="products-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      <!-- Always in the layout flow: toggling it on selection used to shift
           every row down by the bar's height, so the operator's next click
           landed on the wrong row. Hidden state also leaves the a11y tree
           and the tab order (aria-hidden + inert). -->
      @if (canSelect()) {
        <section
          role="group"
          aria-label="Bulk actions"
          class="flex items-center justify-between gap-4 flex-wrap border border-ink bg-surface p-4"
          [class.invisible]="selectedCount() === 0"
          [attr.aria-hidden]="selectedCount() === 0 ? 'true' : null"
          [attr.inert]="selectedCount() === 0 ? '' : null"
          data-testid="products-bulk-bar"
        >
          <p class="text-sm text-ink">
            <span class="tabular-nums" data-testid="products-bulk-bar-count">
              {{ selectedCount() }}
            </span>
            selected
          </p>
          <div class="flex items-center gap-3 flex-wrap">
            <app-button
              variant="secondary"
              size="sm"
              (clicked)="clearSelection()"
              data-testid="products-bulk-bar-clear"
            >
              Clear
            </app-button>
            @if (canBulkUpdate()) {
              <app-button
                variant="primary"
                size="sm"
                (clicked)="openBulkStatusDialog()"
                data-testid="products-bulk-bar-status"
              >
                Change status
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                [disabled]="!canBulkUpdatePrices()"
                (clicked)="openBulkPriceDialog()"
                data-testid="products-bulk-bar-prices"
              >
                Update prices
              </app-button>
            }
            @if (canSeoManage()) {
              <app-button
                variant="primary"
                size="sm"
                (clicked)="openBulkIndexingDialog()"
                data-testid="products-bulk-bar-indexing"
              >
                Request indexing ({{ selectedCount() }})
              </app-button>
            }
          </div>
        </section>
      }

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Products list
            </caption>
            <thead class="border-b border-line">
              <tr class="text-start">
                @if (canSelect()) {
                  <th scope="col" class="px-2 py-3 w-12">
                    <app-checkbox
                      [checked]="allVisibleSelected()"
                      [indeterminate]="partiallySelected()"
                      [disabled]="rows().length === 0"
                      ariaLabel="Select all products on this page"
                      id="products-select-all"
                      data-testid="products-select-all"
                      (changed)="toggleAllVisible($event)"
                    />
                  </th>
                }
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
                  Slug
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
                  Status
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Variants
                </th>
                @if (canSeoManage()) {
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 text-end"
                  >
                    Actions
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @if (canSelect()) {
                      <td class="px-2 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                    @for (__ of [0, 1, 2, 3, 4]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                    @if (canSeoManage()) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    [attr.colspan]="emptyColspan()"
                    class="px-4 py-16 text-center text-ink-muted tabular text-sm"
                  >
                    No products match the current filter.
                  </td>
                </tr>
              } @else {
                @for (product of rows(); track product.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'product-row-' + product.id"
                  >
                    @if (canSelect()) {
                      <td class="px-2 py-3">
                        <app-checkbox
                          [checked]="isSelected(product.id)"
                          [ariaLabel]="'Select ' + pickTranslatable(product.name)"
                          [id]="'product-row-checkbox-' + product.id"
                          [attr.data-testid]="'product-row-checkbox-' + product.id"
                          (changed)="toggleRow(product.id)"
                        />
                      </td>
                    }
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/products', product.id]"
                        class="tabular text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ pickTranslatable(product.name) }}
                      </a>
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ product.slug }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink tabular-nums">
                      {{ defaultVariantPrice(product) | money }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(product.status)"
                        [ariaLabel]="'Product status: ' + product.status"
                      >
                        {{ product.status }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted tabular-nums">
                      {{ product.variants?.length ?? 0 }}
                    </td>
                    @if (canSeoManage()) {
                      <td class="px-4 py-3 text-end">
                        <app-button
                          variant="ghost"
                          size="sm"
                          [ariaLabel]="'Request indexing for ' + pickTranslatable(product.name)"
                          (clicked)="openRowIndexingDialog(product)"
                          [attr.data-testid]="'product-row-indexing-' + product.id"
                        >
                          Request indexing
                        </app-button>
                      </td>
                    }
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
        testIdPrefix="products"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class ProductsListPage implements OnInit, OnDestroy {
  private readonly productsService = inject(ProductsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly destroy$ = new Subject<void>();
  private readonly search$ = new Subject<string>();
  private announcementTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly placeholderRows = [0, 1, 2, 3, 4, 5, 6, 7];

  canCreate(): boolean {
    return this.auth.hasAnyPermission(['products:create']);
  }

  canBulkUpdate(): boolean {
    return this.auth.hasAnyPermission(['products:update']);
  }

  canSeoManage(): boolean {
    return this.auth.hasAnyPermission(['seo:manage']);
  }

  /** Either capability enables row selection (bulk status/price OR request indexing). */
  canSelect(): boolean {
    return this.canBulkUpdate() || this.canSeoManage();
  }

  canBulkUpdatePrices(): boolean {
    if (!this.canBulkUpdate()) return false;
    return this.selectedProductsWithVariant().length > 0;
  }

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Product[]>([]);
  readonly total = signal(0);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly announcement = signal<string | null>(null);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly status = computed(() => this.queryParams()['status'] ?? null);
  readonly search = computed(() => this.queryParams()['search'] ?? null);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly selectedCount = computed(() => this.selected().size);
  readonly allVisibleSelected = computed(() => {
    const rows = this.rows();
    if (rows.length === 0) return false;
    const sel = this.selected();
    return rows.every((r) => sel.has(r.id));
  });
  readonly partiallySelected = computed(() => {
    const rows = this.rows();
    if (rows.length === 0) return false;
    const sel = this.selected();
    const hits = rows.filter((r) => sel.has(r.id)).length;
    return hits > 0 && hits < rows.length;
  });

  readonly statusOptions = [
    { value: null, label: 'All' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'ARCHIVED', label: 'Archived' },
  ] as const;

  protected readonly pickTranslatable = (value: unknown): string =>
    pickTranslatable(value, this.auth.locale(), this.storeSettings.defaultLocale());
  protected readonly statusTone = productStatusTone;

  ngOnInit(): void {
    this.search$
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((term) => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { search: term || null, page: null },
          queryParamsHandling: 'merge',
        });
      });

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.clearSelection();
      this.fetch();
    });
  }

  onSearch(event: Event): void {
    this.search$.next((event.target as HTMLInputElement).value);
  }

  ngOnDestroy(): void {
    if (this.announcementTimer) clearTimeout(this.announcementTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  setStatus(status: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status, page: null },
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

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggleRow(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  toggleAllVisible(checked: boolean): void {
    if (checked) {
      const next = new Set(this.selected());
      for (const row of this.rows()) next.add(row.id);
      this.selected.set(next);
    } else {
      const next = new Set(this.selected());
      for (const row of this.rows()) next.delete(row.id);
      this.selected.set(next);
    }
  }

  clearSelection(): void {
    if (this.selected().size > 0) this.selected.set(new Set());
  }

  openBulkStatusDialog(): void {
    const productIds = Array.from(this.selected());
    if (productIds.length === 0) return;
    const data: BulkStatusDialogData = { productIds };
    const ref = this.dialog.open<BulkStatusDialogResult | null>(BulkStatusDialogComponent, {
      data,
      backdropClass: 'cdk-overlay-backdrop-brand',
      panelClass: 'cdk-overlay-panel-brand',
      ariaModal: true,
      ariaLabelledBy: 'bulk-status-dialog-title',
      hasBackdrop: true,
      disableClose: false,
    });
    ref.closed.subscribe((result) => {
      if (!result) return;
      this.announce(
        `${result.count} ${result.count === 1 ? 'product' : 'products'} moved to ${result.status}.`,
      );
      this.clearSelection();
      this.fetch();
    });
  }

  /** Column count for the empty-state row — must equal the rendered <th> count. */
  emptyColspan(): number {
    return 5 + (this.canSelect() ? 1 : 0) + (this.canSeoManage() ? 1 : 0);
  }

  openRowIndexingDialog(product: Product): void {
    this.openIndexingDialog(
      [product.id],
      pickTranslatable(product.name, this.auth.locale(), this.storeSettings.defaultLocale()),
    );
  }

  openBulkIndexingDialog(): void {
    const productIds = Array.from(this.selected());
    if (productIds.length === 0) return;
    this.openIndexingDialog(productIds);
  }

  private openIndexingDialog(productIds: string[], singleName?: string): void {
    const count = productIds.length;
    const noun = count === 1 ? 'product' : 'products';
    const data: SeoSubmitDialogData = {
      title: singleName ? `Request indexing` : `Request indexing for ${count} ${noun}`,
      description: singleName
        ? `Submits “${singleName}” to IndexNow so search engines re-crawl it. This does not change the product.`
        : `Submits ${count} ${noun} to IndexNow so search engines re-crawl them. This does not change the products.`,
      confirmLabel: 'Request indexing',
      request: { productIds },
    };
    const ref = this.dialog.open<SeoSubmitDialogResult | null>(SeoSubmitDialogComponent, {
      data,
      backdropClass: 'cdk-overlay-backdrop-brand',
      panelClass: 'cdk-overlay-panel-brand',
      ariaModal: true,
      ariaLabelledBy: SEO_SUBMIT_DIALOG_TITLE_ID,
      ariaDescribedBy: SEO_SUBMIT_DIALOG_DESC_ID,
      hasBackdrop: true,
      disableClose: false,
    });
    ref.closed.subscribe((res) => {
      if (!res) return;
      this.announce(summarizeSeoSubmit(res).message);
      if (!singleName) this.clearSelection();
    });
  }

  openBulkPriceDialog(): void {
    const rows = this.selectedProductsWithVariant();
    if (rows.length === 0) return;
    const data: BulkPricesDialogData = { rows };
    const ref = this.dialog.open<BulkPricesDialogResult | null>(BulkPricesDialogComponent, {
      data,
      backdropClass: 'cdk-overlay-backdrop-brand',
      panelClass: 'cdk-overlay-panel-brand',
      ariaModal: true,
      ariaLabelledBy: 'bulk-prices-dialog-title',
      hasBackdrop: true,
      disableClose: false,
    });
    ref.closed.subscribe((result) => {
      if (!result) return;
      this.announce(`${result.count} ${result.count === 1 ? 'product' : 'products'} updated.`);
      this.clearSelection();
      this.fetch();
    });
  }

  defaultVariantPrice(product: Product): string | number | null {
    const variant = defaultVariantFor(product);
    return variant?.price ?? null;
  }

  private selectedProductsWithVariant(): BulkPriceRow[] {
    const sel = this.selected();
    const out: BulkPriceRow[] = [];
    for (const product of this.rows()) {
      if (!sel.has(product.id)) continue;
      const variant = defaultVariantFor(product);
      if (!variant) continue;
      const price = typeof variant.price === 'string' ? Number(variant.price) : variant.price;
      out.push({
        productId: product.id,
        productName: pickTranslatable(
          product.name,
          this.auth.locale(),
          this.storeSettings.defaultLocale(),
        ),
        variantId: variant.id,
        variantSku: variant.sku,
        currentPrice: Number.isFinite(price) ? (price as number) : 0,
      });
    }
    return out;
  }

  private announce(message: string): void {
    if (this.announcementTimer) clearTimeout(this.announcementTimer);
    this.announcement.set(message);
    this.announcementTimer = setTimeout(() => this.announcement.set(null), 4000);
  }

  private fetch(): void {
    const query: ListProductsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    const status = this.status();
    if (status) {
      const parsed = productStatusSchema.safeParse(status);
      if (parsed.success) query.status = parsed.data;
    }
    const search = this.search();
    if (search) query.search = search;

    this.loading.set(true);
    this.error.set(null);
    this.productsService
      .listProducts(query)
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view products.';
    if (err instanceof ApiNotFoundError) return 'Products not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load products. Please retry.';
  }
}
