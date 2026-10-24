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
  openConfirmDialog,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { CmsService, type CmsPage, type CmsPageType, type ListPagesQuery } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { humanizeCode } from '../../shared/format/enum-label';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

const typeTone: Record<CmsPageType, 'neutral' | 'warning' | 'info'> = {
  STATIC: 'neutral',
  POLICY: 'warning',
  LANDING: 'info',
};

const typeLabel: Record<CmsPageType, string> = {
  STATIC: 'Static',
  POLICY: 'Policy',
  LANDING: 'Landing',
};

@Component({
  selector: 'app-cms-pages-list-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    SkeletonComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="cms-pages-list-page">
      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Content</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Pages</h1>
          <p class="mt-3 text-sm text-ink-muted">
            Custom content pages — legal, FAQ, about, landing — served by slug.
          </p>
        </div>
        @if (canCreate()) {
          <a
            routerLink="/pages/new"
            class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
            data-testid="cms-pages-new-cta"
          >
            Create page
          </a>
        }
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="cms-pages-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              CMS pages
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
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
                  Type
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Title
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Published
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Sort
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Updated
                </th>
                @if (canManage()) {
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 w-40"
                  >
                    <span class="sr-only">Actions</span>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of skeletonRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of columnSkeleton(); track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    [attr.colspan]="canManage() ? 7 : 6"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="cms-pages-empty"
                  >
                    No pages yet. Create one to get started.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'cms-page-row-' + item.id"
                  >
                    <td class="px-4 py-3 font-mono text-xs text-ink break-all">
                      {{ item.slug }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="typeTone(item.type)"
                        [ariaLabel]="'Page type: ' + typeLabel(item.type)"
                      >
                        {{ typeLabel(item.type) }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink">
                      {{ defaultText(item.title) }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="item.isPublished ? 'success' : 'neutral'"
                        [ariaLabel]="item.isPublished ? 'Status: Published' : 'Status: Draft'"
                      >
                        {{ item.isPublished ? 'Published' : 'Draft' }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted font-mono tabular-nums">
                      {{ item.sortOrder }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted font-mono tabular-nums">
                      {{ item.updatedAt | adminDate }}
                    </td>
                    @if (canManage()) {
                      <td class="px-4 py-3">
                        <div class="flex items-center gap-2">
                          @if (canUpdate()) {
                            <a
                              [routerLink]="['/pages', item.id, 'edit']"
                              class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-3 py-2 text-xs min-h-[44px] border border-line"
                              [attr.data-testid]="'cms-page-edit-' + item.id"
                              [attr.aria-label]="'Edit page ' + item.slug"
                            >
                              Edit
                            </a>
                          }
                          @if (canDelete()) {
                            <app-button
                              variant="ghost"
                              size="sm"
                              [attr.data-testid]="'cms-page-delete-' + item.id"
                              [ariaLabel]="'Delete page ' + item.slug"
                              [disabled]="deletingId() === item.id"
                              [loading]="deletingId() === item.id"
                              (clicked)="confirmDelete(item)"
                            >
                              Delete
                            </app-button>
                          }
                        </div>
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
        testIdPrefix="cms-pages"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class CmsPagesListPage implements OnInit, OnDestroy {
  private readonly cms = inject(CmsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(Dialog);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly typeTone = (type: CmsPageType) => typeTone[type];
  protected readonly typeLabel = (type: CmsPageType): string =>
    typeLabel[type] ?? humanizeCode(type);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly CmsPage[]>([]);
  readonly total = signal(0);
  readonly deletingId = signal<string | null>(null);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Math.min(100, Number(this.queryParams()['pageSize'] ?? '20')));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly canCreate = computed(() => this.auth.hasPermission('cms:create'));
  readonly canUpdate = computed(() => this.auth.hasPermission('cms:update'));
  readonly canDelete = computed(() => this.auth.hasPermission('cms:delete'));
  readonly canManage = computed(() => this.canUpdate() || this.canDelete());
  readonly columnSkeleton = computed(() =>
    this.canManage() ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5],
  );

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  async confirmDelete(item: CmsPage): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this page?',
      body: `${item.slug} — ${this.defaultText(item.title)}`,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.deletingId.set(item.id);
    this.cms
      .delete(item.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deletingId.set(null);
          this.fetch();
        },
        error: (err: unknown) => {
          this.deletingId.set(null);
          this.error.set(this.formatError(err));
        },
      });
  }

  defaultText(value: { default?: string } | null | undefined): string {
    const v = value?.default;
    return typeof v === 'string' && v.length > 0 ? v : '—';
  }

  private fetch(): void {
    const query: ListPagesQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    this.loading.set(true);
    this.error.set(null);
    this.cms
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage pages.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load pages. Please retry.';
  }
}
