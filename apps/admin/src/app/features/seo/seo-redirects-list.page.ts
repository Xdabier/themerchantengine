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
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  openConfirmDialog,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import {
  SeoService,
  type ListRedirectsQuery,
  type Redirect,
  type RedirectType,
} from '@admin-services';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

type AutoFilter = 'ALL' | 'MANUAL' | 'AUTO';
type SortField = 'createdAt' | 'fromPath' | 'toPath';

const redirectTypeLabel: Record<RedirectType, string> = {
  MOVED_PERMANENTLY: '301',
  FOUND: '302',
};

@Component({
  selector: 'app-seo-redirects-list-page',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    SkeletonComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="seo-redirects-list-page">
      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">SEO</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Redirects</h1>
          <p class="mt-3 text-sm text-ink-muted">
            301 and 302 redirects — manage and audit slug-change history.
          </p>
        </div>
        @if (canCreate()) {
          <a
            routerLink="/seo/redirects/new"
            class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
            data-testid="seo-redirects-new-cta"
          >
            Create redirect
          </a>
        }
      </header>

      <div class="flex items-start gap-6 flex-wrap">
        <div
          class="flex items-center gap-3 flex-wrap"
          role="group"
          aria-label="Filter redirects by origin"
        >
          <span class="text-xs tracking-widest uppercase text-ink-muted">Origin</span>
          @for (opt of autoOptions; track opt.value) {
            <button
              type="button"
              class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [class.border-ink]="autoFilter() === opt.value"
              [class.text-ink]="autoFilter() === opt.value"
              [class.border-line]="autoFilter() !== opt.value"
              [class.text-ink-muted]="autoFilter() !== opt.value"
              [attr.aria-pressed]="autoFilter() === opt.value"
              [attr.data-testid]="'seo-filter-chip-' + opt.value"
              (click)="setAutoFilter(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>
        <label class="flex items-center gap-3 text-xs tracking-widest uppercase text-ink-muted">
          Search
          <input
            type="search"
            [formControl]="searchControl"
            placeholder="/old"
            class="min-h-[44px] w-56 px-3 py-2 bg-surface border border-line text-ink text-sm tabular focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            data-testid="seo-search"
          />
        </label>
      </div>

      @if (error()) {
        <p
          class="text-xs p-3 border border-status-error text-ink"
          role="alert"
          aria-atomic="true"
          data-testid="seo-redirects-error"
        >
          {{ error() }}
        </p>
      }

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              SEO redirects
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  From
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  To
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
                  Origin
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Created
                </th>
                @if (canDelete()) {
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 w-24"
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
                    [attr.colspan]="canDelete() ? 6 : 5"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="seo-redirects-empty"
                  >
                    No redirects match the current filter.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'seo-redirect-row-' + item.id"
                  >
                    <td class="px-4 py-3 font-mono text-xs text-ink break-all">
                      {{ item.fromPath }}
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-ink-muted break-all">
                      {{ item.toPath }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="item.type === 'MOVED_PERMANENTLY' ? 'warning' : 'neutral'"
                        [ariaLabel]="'Redirect type: ' + typeLabel(item.type)"
                      >
                        {{ typeLabel(item.type) }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted tabular">
                      {{ item.isAutoGenerated ? 'Auto' : 'Manual' }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.createdAt | adminDate }}
                    </td>
                    @if (canDelete()) {
                      <td class="px-4 py-3">
                        <app-button
                          variant="ghost"
                          size="sm"
                          [attr.data-testid]="'seo-redirect-delete-' + item.id"
                          [disabled]="deletingId() === item.id"
                          [loading]="deletingId() === item.id"
                          (clicked)="confirmDelete(item)"
                        >
                          Delete
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
        testIdPrefix="seo-redirects"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class SeoRedirectsListPage implements OnInit, OnDestroy {
  private readonly seoService = inject(SeoService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(Dialog);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5];
  protected readonly typeLabel = (type: RedirectType) => redirectTypeLabel[type];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Redirect[]>([]);
  readonly total = signal(0);
  readonly deletingId = signal<string | null>(null);

  readonly searchControl = new FormControl('', { nonNullable: true });

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly autoFilter = computed<AutoFilter>(() => {
    const raw = this.queryParams()['isAutoGenerated'];
    if (raw === 'true') return 'AUTO';
    if (raw === 'false') return 'MANUAL';
    return 'ALL';
  });
  readonly search = computed(() => this.queryParams()['search'] ?? '');
  readonly sortBy = computed<SortField>(() => {
    const raw = this.queryParams()['sortBy'];
    return raw === 'fromPath' || raw === 'toPath' ? raw : 'createdAt';
  });
  readonly sortOrder = computed<'asc' | 'desc'>(() =>
    this.queryParams()['sortOrder'] === 'asc' ? 'asc' : 'desc',
  );
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly canCreate = computed(() => this.auth.hasPermission('seo:create'));
  readonly canDelete = computed(() => this.auth.hasPermission('seo:delete'));
  readonly columnSkeleton = computed(() =>
    this.canDelete() ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4],
  );

  readonly autoOptions: { value: AutoFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'MANUAL', label: 'Manual' },
    { value: 'AUTO', label: 'Auto-generated' },
  ];

  ngOnInit(): void {
    this.searchControl.setValue(this.search(), { emitEvent: false });
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        const trimmed = value.trim();
        if (trimmed === (this.queryParams()['search'] ?? '')) return;
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { search: trimmed || null, page: null },
          queryParamsHandling: 'merge',
        });
      });

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setAutoFilter(value: AutoFilter): void {
    const param = value === 'AUTO' ? 'true' : value === 'MANUAL' ? 'false' : null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { isAutoGenerated: param, page: null },
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

  async confirmDelete(item: Redirect): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this redirect?',
      body: `${item.fromPath} → ${item.toPath}`,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.deletingId.set(item.id);
    this.seoService
      .deleteRedirect(item.id)
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

  private fetch(): void {
    const query: ListRedirectsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
      sortBy: this.sortBy(),
      sortOrder: this.sortOrder(),
    };
    const auto = this.autoFilter();
    if (auto === 'AUTO') query.isAutoGenerated = true;
    if (auto === 'MANUAL') query.isAutoGenerated = false;
    const search = this.search();
    if (search) query.search = search;

    this.loading.set(true);
    this.error.set(null);
    this.seoService
      .listRedirects(query)
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage redirects.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load redirects. Please retry.';
  }
}
