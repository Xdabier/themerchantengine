import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LoadErrorComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import { CategoriesService, ProductsService, type Category, type Product } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { flattenAllCategories } from '../categories/categories.utils';
import { pickTranslatable } from '../products/products.utils';
import { AuthStore } from '../../core/stores/auth.store';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * Promotion scope editor — embedded below the main promotion form.
 *
 * Two sub-pickers:
 *   - **Categories**: flat checkbox list of the full category tree
 *     (the tree is always small enough to render all rows). Mirrors
 *     the pattern used by the product editor's General tab.
 *   - **Products**: debounced search input + paginated checkbox list
 *     (products can be large, so we never load the full set). Selected
 *     rows show as removable chips above the search so they stay
 *     visible after the results reshuffle.
 *
 * State flows in via `initialProductIds` / `initialCategoryIds` and out
 * via `(changed)` — parent owns the `eligibilityDirty` signal and the
 * PATCH body assembly. The component never mutates server state
 * directly, matching the product-edit category picker contract.
 */
@Component({
  selector: 'app-promotion-scope-editor',
  standalone: true,
  imports: [LoadErrorComponent, PaginationComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-8" data-testid="promotion-scope">
      <div role="status" aria-live="polite" data-testid="promotion-scope-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (categoriesError()) {
        <app-load-error
          [message]="categoriesError()!"
          [compact]="true"
          [retrying]="categoriesLoading()"
          retryLabel="categories"
          testId="promotion-categories-degraded"
          (retry)="fetchCategories()"
        />
      }

      <fieldset class="border border-line p-4" data-testid="promotion-scope-categories">
        <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">Categories</legend>
        <p class="text-xs tabular text-ink-muted mb-3">
          Restrict the promotion to specific categories. Leave empty to apply across all.
        </p>
        @if (categoriesLoading()) {
          <div class="flex flex-col gap-2">
            <app-skeleton height="0.75rem" width="60%" />
            <app-skeleton height="0.75rem" width="50%" />
            <app-skeleton height="0.75rem" width="70%" />
          </div>
        } @else if (categoryList().length === 0) {
          <p class="tabular text-sm text-ink-muted">No categories defined yet.</p>
        } @else {
          <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto" role="list">
            @for (node of categoryList(); track node.id) {
              <li>
                <label class="flex items-center gap-3 text-sm tabular">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-ink"
                    [checked]="selectedCategoryIds().has(node.id)"
                    (change)="toggleCategory(node.id, $event)"
                    [attr.data-testid]="'promotion-category-' + node.id"
                  />
                  <span [style.paddingLeft.rem]="node.depth * 0.75">
                    {{ node.label }}
                  </span>
                </label>
              </li>
            }
          </ul>
        }
      </fieldset>

      <fieldset class="border border-line p-4" data-testid="promotion-scope-products">
        <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">Products</legend>
        <p class="text-xs tabular text-ink-muted mb-3">
          Restrict the promotion to specific products. Use search to narrow the browser.
        </p>

        @if (selectedProducts().length > 0) {
          <ul
            class="flex flex-wrap gap-2 mb-4"
            role="list"
            aria-label="Selected products"
            data-testid="promotion-selected-products"
          >
            @for (p of selectedProducts(); track p.id) {
              <li
                class="inline-flex items-center gap-2 border border-line px-2 py-1 tabular text-xs text-ink"
              >
                <span>{{ productLabel(p) }}</span>
                <button
                  type="button"
                  class="text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  [attr.aria-label]="'Remove ' + productLabel(p)"
                  (click)="deselectProduct(p.id)"
                  [attr.data-testid]="'promotion-product-chip-remove-' + p.id"
                >
                  ×
                </button>
              </li>
            }
          </ul>
        }

        <div class="mb-3">
          <label for="promotion-product-search" class="sr-only">Search products</label>
          <input
            id="promotion-product-search"
            type="search"
            inputmode="search"
            class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line placeholder:text-ink-muted focus:outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            placeholder="Search products by name or slug…"
            [value]="searchTerm()"
            (input)="onSearch($event)"
            data-testid="promotion-product-search"
          />
        </div>

        @if (productsLoading()) {
          <div class="flex flex-col gap-2">
            <app-skeleton height="0.75rem" width="70%" />
            <app-skeleton height="0.75rem" width="50%" />
          </div>
        } @else if (productResults().length === 0) {
          <p class="tabular text-sm text-ink-muted">
            @if (searchTerm().length === 0) {
              Start typing to browse products.
            } @else {
              No products match "{{ searchTerm() }}".
            }
          </p>
        } @else {
          <ul
            class="flex flex-col gap-1 max-h-72 overflow-y-auto"
            role="list"
            data-testid="promotion-product-results"
          >
            @for (p of productResults(); track p.id) {
              <li>
                <label class="flex items-center gap-3 text-sm tabular py-1">
                  <input
                    type="checkbox"
                    class="h-4 w-4 accent-ink"
                    [checked]="selectedProductIds().has(p.id)"
                    (change)="toggleProduct(p, $event)"
                    [attr.data-testid]="'promotion-product-row-' + p.id"
                  />
                  <span class="flex-1 min-w-0 truncate">
                    {{ productLabel(p) }}
                    <span class="text-ink-muted ml-2 text-xs">/{{ p.slug }}</span>
                  </span>
                </label>
              </li>
            }
          </ul>

          <app-pagination
            class="mt-3 block"
            [page]="productsPage()"
            [pageSize]="productsPageSize()"
            [total]="productTotal()"
            [loading]="productsLoading()"
            testIdPrefix="promotion-product"
            (pageChange)="goToProductPage($event)"
          />
        }
      </fieldset>
    </section>
  `,
})
export class PromotionScopeEditorComponent implements OnInit, OnDestroy {
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly categoriesService = inject(CategoriesService);
  private readonly productsService = inject(ProductsService);
  private readonly destroy$ = new Subject<void>();
  private readonly search$ = new Subject<string>();

  readonly initialProductIds = input<readonly string[]>([]);
  readonly initialCategoryIds = input<readonly string[]>([]);
  /** Fires whenever the selection changes so the parent can flip its dirty flag. */
  readonly changed = output<{ productIds: string[]; categoryIds: string[] }>();

  readonly error = signal<string | null>(null);

  readonly categoriesLoading = signal(true);
  readonly categoriesError = signal<string | null>(null);
  readonly categoryList = signal<readonly { id: string; label: string; depth: number }[]>([]);
  readonly selectedCategoryIds = signal<ReadonlySet<string>>(new Set());

  readonly productsLoading = signal(false);
  readonly productResults = signal<readonly Product[]>([]);
  readonly productTotal = signal(0);
  readonly productsPage = signal(1);
  readonly productsPageSize = signal(20);
  readonly searchTerm = signal('');

  /** Selected products are kept separately from results so removing a chip
   *  still shows the product even when it's outside the current search page. */
  readonly selectedProducts = signal<readonly Product[]>([]);
  readonly selectedProductIds = computed<ReadonlySet<string>>(
    () => new Set(this.selectedProducts().map((p) => p.id)),
  );

  readonly productTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.productTotal() / this.productsPageSize())),
  );

  ngOnInit(): void {
    // Seed once at init from the parent's ids. The component never
    // re-syncs with the parent afterwards — if the loaded promotion
    // changes, the parent re-creates the page (route navigation) and
    // therefore re-creates this component. Using an effect() here
    // instead produced a jest deadlock under zoneless CD in v21.
    this.selectedCategoryIds.set(new Set(this.initialCategoryIds()));
    this.seedSelectedProducts(this.initialProductIds());

    this.fetchCategories();
    this.search$
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((term) => {
        this.searchTerm.set(term);
        this.productsPage.set(1);
        this.fetchProducts();
      });
    // Prime the first page of results so the picker feels populated.
    this.fetchProducts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  productLabel(product: Product): string {
    // `pickTranslatable` returns the em-dash placeholder rather than nullish,
    // so a `??` tail here would be unreachable.
    return pickTranslatable(
      product.name,
      this.authStore.locale(),
      this.storeSettings.defaultLocale(),
    );
  }

  toggleCategory(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selectedCategoryIds());
    if (checked) next.add(id);
    else next.delete(id);
    this.selectedCategoryIds.set(next);
    this.emitChanged();
  }

  toggleProduct(product: Product, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = [...this.selectedProducts()];
    const idx = current.findIndex((p) => p.id === product.id);
    if (checked && idx === -1) current.push(product);
    if (!checked && idx !== -1) current.splice(idx, 1);
    this.selectedProducts.set(current);
    this.emitChanged();
  }

  deselectProduct(id: string): void {
    this.selectedProducts.set(this.selectedProducts().filter((p) => p.id !== id));
    this.emitChanged();
  }

  onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search$.next(value);
  }

  /** One entry point for the shared pager; the guards live in the helpers. */
  goToProductPage(page: number): void {
    if (page < this.productsPage()) this.prevPage();
    else if (page > this.productsPage()) this.nextPage();
  }

  prevPage(): void {
    if (this.productsPage() <= 1) return;
    this.productsPage.update((n) => n - 1);
    this.fetchProducts();
  }

  nextPage(): void {
    if (this.productsPage() >= this.productTotalPages()) return;
    this.productsPage.update((n) => n + 1);
    this.fetchProducts();
  }

  private emitChanged(): void {
    this.changed.emit({
      productIds: [...this.selectedProductIds()],
      categoryIds: [...this.selectedCategoryIds()],
    });
  }

  fetchCategories(): void {
    this.categoriesLoading.set(true);
    this.categoriesService
      .tree()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (nodes: readonly Category[]) => {
          this.categoryList.set(
            flattenAllCategories(
              nodes,
              this.authStore.locale(),
              this.storeSettings.defaultLocale(),
            ),
          );
          this.categoriesError.set(null);
          this.categoriesLoading.set(false);
        },
        error: () => {
          this.categoryList.set([]);
          this.categoriesError.set('Could not load categories.');
          this.categoriesLoading.set(false);
        },
      });
  }

  private fetchProducts(): void {
    const term = this.searchTerm().trim();
    this.productsLoading.set(true);
    this.productsService
      .listProducts({
        page: this.productsPage(),
        pageSize: this.productsPageSize(),
        ...(term ? { search: term } : {}),
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.productResults.set(res.data);
          this.productTotal.set(res.meta.total);
          this.productsLoading.set(false);
        },
        error: (err: unknown) => {
          this.productsLoading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  /**
   * Materialise placeholder `Product` rows from raw ids so chips render
   * immediately on open. When the server responses arrive we hydrate
   * each placeholder with the real row so the label sharpens.
   */
  private seedSelectedProducts(ids: readonly string[]): void {
    const existing = new Map(this.selectedProducts().map((p) => [p.id, p]));
    const next = ids.map(
      (id) =>
        existing.get(id) ??
        ({
          id,
          name: { default: id },
          slug: id,
        } as unknown as Product),
    );
    this.selectedProducts.set(next);

    // Hydrate any placeholder by looking them up one by one. Gated at
    // 20 max to keep the lookup cheap; anything beyond just shows ids
    // until the user searches.
    const toHydrate = next.filter(
      (p) =>
        (p.name as unknown) &&
        typeof p.name === 'object' &&
        (p.name as { default?: string }).default === p.id,
    );
    if (toHydrate.length === 0 || toHydrate.length > 20) return;

    for (const row of toHydrate) {
      this.productsService
        .getProduct(row.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (full) => {
            this.selectedProducts.update((list) => list.map((p) => (p.id === full.id ? full : p)));
          },
          // query-error-guard: allow — per-row name hydration; the row still
          // renders with its id, so nothing disappears from the operator's view.
          error: () => {
            // Silently keep the placeholder; we still know the id.
          },
        });
    }
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to browse products.';
    if (err instanceof ApiNotFoundError) return 'Products not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load product list. Please retry.';
  }
}
