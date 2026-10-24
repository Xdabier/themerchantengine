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
import { ButtonComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import { openConfirmDialog } from '@admin-ui';
import { ProductsService, TaxService, type ProductType, type TaxClass } from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, forkJoin, of, takeUntil } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthStore } from '../../core/stores/auth.store';
import {
  ProductTypeDialogComponent,
  type ProductTypeDialogData,
  type ProductTypeDialogResult,
} from './product-type-dialog.component';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

function typeLabel(pt: ProductType, locale: string, defaultLocale: string): string {
  return pickTranslation(
    pt.name as Translatable | string | null | undefined,
    locale,
    pt.code,
    defaultLocale,
  );
}

@Component({
  selector: 'app-product-types-list-page',
  standalone: true,
  imports: [RouterLink, ButtonComponent, SkeletonComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="product-types-list-page">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <nav aria-label="Breadcrumb" class="text-xs tracking-widest uppercase text-ink-muted">
            <a
              routerLink="/settings"
              class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              Settings
            </a>
            <span aria-hidden="true">&nbsp;›&nbsp;</span>
            <span aria-current="page">Product types</span>
          </nav>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Product types</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            A product type bundles the attributes every product in that family exposes. Required
            before creating a product with variants.
          </p>
        </div>
        @if (canCreate()) {
          <app-button
            variant="primary"
            size="md"
            (clicked)="openCreateDialog()"
            data-testid="product-types-create-cta"
          >
            New product type
          </app-button>
        }
      </header>

      <div role="status" aria-live="polite" data-testid="product-types-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Product types
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
                  Attributes
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 text-right"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of [0, 1, 2, 3]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    colspan="4"
                    class="px-4 py-16 text-center text-ink-muted tabular text-sm"
                    data-testid="product-types-empty"
                  >
                    No product types yet.
                    @if (canCreate()) {
                      Click &ldquo;New product type&rdquo; to add one.
                    }
                  </td>
                </tr>
              } @else {
                @for (pt of rows(); track pt.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'product-type-row-' + pt.id"
                  >
                    <td class="px-4 py-3 tabular text-sm text-ink">{{ label(pt) }}</td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">{{ pt.code }}</td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">
                      {{ pt.attributeCount ?? 0 }}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center justify-end gap-2">
                        @if (canUpdate()) {
                          <app-button
                            variant="secondary"
                            size="sm"
                            (clicked)="openEditDialog(pt)"
                            [attr.data-testid]="'product-type-edit-' + pt.id"
                          >
                            Edit
                          </app-button>
                        }
                        @if (canDelete()) {
                          <app-button
                            variant="ghost"
                            size="sm"
                            (clicked)="confirmDelete(pt)"
                            [attr.data-testid]="'product-type-delete-' + pt.id"
                          >
                            Delete
                          </app-button>
                        }
                      </div>
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
        testIdPrefix="product-types"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class ProductTypesListPage implements OnInit, OnDestroy {
  private readonly products = inject(ProductsService);
  private readonly tax = inject(TaxService);
  private readonly dialog = inject(Dialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly ProductType[]>([]);
  readonly total = signal(0);
  readonly taxClasses = signal<readonly TaxClass[]>([]);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  protected readonly label = (pt: ProductType): string =>
    typeLabel(pt, this.auth.locale(), this.storeSettings.defaultLocale());

  canCreate(): boolean {
    return this.auth.hasAnyPermission(['products:create']);
  }

  canUpdate(): boolean {
    return this.auth.hasAnyPermission(['products:update']);
  }

  canDelete(): boolean {
    return this.auth.hasAnyPermission(['products:delete']);
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToPage(target: number): void {
    if (target < 1 || target > this.totalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: target },
      queryParamsHandling: 'merge',
    });
  }

  openCreateDialog(): void {
    this.openDialog({ mode: 'create', taxClasses: this.taxClasses() });
  }

  openEditDialog(productType: ProductType): void {
    this.openDialog({ mode: 'edit', productType, taxClasses: this.taxClasses() });
  }

  private openDialog(data: ProductTypeDialogData): void {
    const ref = this.dialog.open<ProductTypeDialogResult>(ProductTypeDialogComponent, {
      data,
      panelClass: 'cdk-overlay-panel-brand',
      backdropClass: 'cdk-overlay-backdrop-brand',
      ariaModal: true,
      ariaLabelledBy: 'product-type-dialog-title',
    });
    ref.closed.pipe(takeUntil(this.destroy$)).subscribe((result) => {
      if (result?.kind === 'saved') this.fetch();
    });
  }

  async confirmDelete(pt: ProductType): Promise<void> {
    const label = this.label(pt);
    const confirmed = await openConfirmDialog(this.dialog, {
      title: `Delete "${label}"?`,
      body: 'Products of this type will lose their type association. Products currently using this type will block the delete.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!confirmed) return;
    this.products.deleteProductType(pt.id).subscribe({
      next: () => this.fetch(),
      error: (err: unknown) => this.error.set(this.formatError(err)),
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      types: this.products.listProductTypes({ page: this.page(), pageSize: this.pageSize() }),
      taxClasses: this.tax
        .listClasses({ pageSize: 100 })
        .pipe(
          catchError(() =>
            of({ data: [] as TaxClass[], meta: { page: 1, pageSize: 0, total: 0 } }),
          ),
        ),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ types, taxClasses }) => {
          this.rows.set(types.data);
          this.total.set(types.meta.total);
          this.taxClasses.set(taxClasses.data);
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
      return 'You do not have permission to view product types.';
    if (err instanceof ApiNotFoundError) return 'Product type not found.';
    if (err instanceof ApiConflictError)
      return err.message || 'Products currently use this type. Delete blocked.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load product types.';
  }
}
