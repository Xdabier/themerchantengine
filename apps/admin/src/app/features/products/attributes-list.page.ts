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
  ButtonComponent,
  openConfirmDialog,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import {
  ProductsService,
  type Attribute,
  type ListAttributesQuery,
  type ProductType,
} from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  AttributeDialogComponent,
  type AttributeDialogData,
  type AttributeDialogResult,
} from './attribute-dialog.component';
import {
  AttributeValuesDialogComponent,
  type AttributeValuesDialogData,
  type AttributeValuesDialogResult,
} from './attribute-values-dialog.component';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

function attributeLabel(
  a: Pick<Attribute, 'name' | 'code'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    a.name as Translatable | string | null | undefined,
    locale,
    a.code,
    defaultLocale,
  );
}

function productTypeLabel(pt: ProductType, locale: string, defaultLocale: string): string {
  return pickTranslation(
    pt.name as Translatable | string | null | undefined,
    locale,
    pt.code,
    defaultLocale,
  );
}

@Component({
  selector: 'app-attributes-list-page',
  standalone: true,
  imports: [RouterLink, ButtonComponent, SkeletonComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="attributes-list-page">
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
            <span aria-current="page">Attributes</span>
          </nav>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Attributes</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Attributes define the variant axes (e.g. size, colour). Each attribute is scoped to a
            single product type.
          </p>
        </div>
        @if (canCreate()) {
          <app-button
            variant="primary"
            size="md"
            [disabled]="productTypes().length === 0"
            (clicked)="openCreateDialog()"
            data-testid="attributes-create-cta"
          >
            New attribute
          </app-button>
        }
      </header>

      <div class="flex flex-col gap-2 max-w-sm" role="group" aria-label="Filter by product type">
        <label
          for="attribute-filter-product-type"
          class="text-xs tracking-widest uppercase text-ink-muted"
        >
          Product type
        </label>
        <select
          id="attribute-filter-product-type"
          class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          [value]="productTypeFilter() ?? ''"
          (change)="setProductType($event)"
          data-testid="attributes-filter-product-type"
        >
          <option value="">All product types</option>
          @for (pt of productTypes(); track pt.id) {
            <option [value]="pt.id" [selected]="pt.id === productTypeFilter()">
              {{ typeLabel(pt) }}
            </option>
          }
        </select>
      </div>

      <div role="status" aria-live="polite" data-testid="attributes-error">
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
              Attributes
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
                  Product type
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Values
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
                    @for (__ of [0, 1, 2, 3, 4]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    colspan="5"
                    class="px-4 py-16 text-center text-ink-muted tabular text-sm"
                    data-testid="attributes-empty"
                  >
                    No attributes yet.
                    @if (canCreate() && productTypes().length === 0) {
                      Create a product type first to define attributes.
                    }
                  </td>
                </tr>
              } @else {
                @for (a of rows(); track a.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'attribute-row-' + a.id"
                  >
                    <td class="px-4 py-3 tabular text-sm text-ink">
                      {{ attrLabel(a) }}
                    </td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">{{ a.code }}</td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">
                      {{ productTypeLabelFor(a.productTypeId) }}
                    </td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">
                      {{ a.values?.length ?? 0 }}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center justify-end gap-2 flex-wrap">
                        <app-button
                          variant="secondary"
                          size="sm"
                          (clicked)="openValuesDialog(a)"
                          [attr.data-testid]="'attribute-values-' + a.id"
                        >
                          Manage values
                        </app-button>
                        @if (canUpdate()) {
                          <app-button
                            variant="secondary"
                            size="sm"
                            (clicked)="openEditDialog(a)"
                            [attr.data-testid]="'attribute-edit-' + a.id"
                          >
                            Edit
                          </app-button>
                        }
                        @if (canDelete()) {
                          <app-button
                            variant="ghost"
                            size="sm"
                            (clicked)="confirmDelete(a)"
                            [attr.data-testid]="'attribute-delete-' + a.id"
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
        testIdPrefix="attributes"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class AttributesListPage implements OnInit, OnDestroy {
  private readonly service = inject(ProductsService);
  private readonly dialog = inject(Dialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Attribute[]>([]);
  readonly total = signal(0);
  readonly productTypes = signal<readonly ProductType[]>([]);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly productTypeFilter = computed<string | null>(() => {
    const raw = this.queryParams()['productTypeId'];
    return raw && raw.length > 0 ? raw : null;
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  protected readonly attrLabel = (a: Pick<Attribute, 'name' | 'code'>): string =>
    attributeLabel(a, this.auth.locale(), this.storeSettings.defaultLocale());
  protected readonly typeLabel = (pt: ProductType): string =>
    productTypeLabel(pt, this.auth.locale(), this.storeSettings.defaultLocale());

  canCreate(): boolean {
    return this.auth.hasAnyPermission(['products:create']);
  }

  canUpdate(): boolean {
    return this.auth.hasAnyPermission(['products:update']);
  }

  canDelete(): boolean {
    return this.auth.hasAnyPermission(['products:delete']);
  }

  productTypeLabelFor(id: string | null | undefined): string {
    if (!id) return '—';
    const pt = this.productTypes().find((p) => p.id === id);
    return pt ? this.typeLabel(pt) : id;
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setProductType(event: Event): void {
    const value = (event.target as HTMLSelectElement).value || null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { productTypeId: value, page: null },
      queryParamsHandling: 'merge',
    });
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
    const data: AttributeDialogData = {
      mode: 'create',
      productTypes: this.productTypes(),
      defaultProductTypeId: this.productTypeFilter(),
    };
    this.openDialog(data);
  }

  openEditDialog(attribute: Attribute): void {
    const data: AttributeDialogData = {
      mode: 'edit',
      attribute,
      productTypes: this.productTypes(),
    };
    this.openDialog(data);
  }

  openValuesDialog(attribute: Attribute): void {
    const data: AttributeValuesDialogData = {
      attribute,
      canMutate: this.canUpdate() || this.canCreate() || this.canDelete(),
    };
    const ref = this.dialog.open<AttributeValuesDialogResult>(AttributeValuesDialogComponent, {
      data,
      panelClass: 'cdk-overlay-panel-brand',
      backdropClass: 'cdk-overlay-backdrop-brand',
      ariaModal: true,
      ariaLabelledBy: 'attribute-values-dialog-title',
    });
    ref.closed.pipe(takeUntil(this.destroy$)).subscribe((result) => {
      if (result?.kind === 'changed') this.fetch();
    });
  }

  async confirmDelete(a: Attribute): Promise<void> {
    const label = this.attrLabel(a);
    const confirmed = await openConfirmDialog(this.dialog, {
      title: `Delete "${label}"?`,
      body: 'This removes the attribute and all of its values. Deletion is blocked (409) if any variant still uses a value from this attribute.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!confirmed) return;
    this.service.deleteAttribute(a.id).subscribe({
      next: () => this.fetch(),
      error: (err: unknown) => this.error.set(this.formatError(err)),
    });
  }

  private openDialog(data: AttributeDialogData): void {
    const ref = this.dialog.open<AttributeDialogResult>(AttributeDialogComponent, {
      data,
      panelClass: 'cdk-overlay-panel-brand',
      backdropClass: 'cdk-overlay-backdrop-brand',
      ariaModal: true,
      ariaLabelledBy: 'attribute-dialog-title',
    });
    ref.closed.pipe(takeUntil(this.destroy$)).subscribe((result) => {
      if (result?.kind === 'saved') this.fetch();
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);

    const query: ListAttributesQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    if (this.productTypeFilter()) query.productTypeId = this.productTypeFilter() as string;

    forkJoin({
      attrs: this.service.listAttributes(query),
      types: this.service.listProductTypes({ pageSize: 100 }),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ attrs, types }) => {
          this.rows.set(attrs.data);
          this.total.set(attrs.meta.total);
          this.productTypes.set(types.data);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view attributes.';
    if (err instanceof ApiNotFoundError) return 'Attribute not found.';
    if (err instanceof ApiConflictError)
      return err.message || 'Variants use values from this attribute. Delete blocked.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load attributes.';
  }
}
