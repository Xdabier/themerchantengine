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
import { BadgeComponent, SkeletonComponent } from '@admin-ui';
import {
  GlobalSearchService,
  type GlobalSearchGroup,
  type GlobalSearchResult,
  type GlobalSearchType,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';

const TYPE_LABELS: Record<GlobalSearchType, string> = {
  product: 'Products',
  order: 'Orders',
  customer: 'Customers',
  cms: 'CMS pages',
};

const ALL_TYPES: GlobalSearchType[] = ['product', 'order', 'customer', 'cms'];

/** Module list a truncated group links out to, or null when none accepts a search term. */
const VIEW_ALL_ROUTES: Record<GlobalSearchType, string | null> = {
  product: '/products',
  order: '/orders',
  customer: '/customers',
  cms: null,
};

/**
 * `/search?q=...&types=...` — full-page global search results. The Cmd+K
 * overlay's "See all results" link lands here with richer per-group
 * pagination room (limit 20 per type vs. 5 in the overlay).
 */
@Component({
  selector: 'app-search-results-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="search-results-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Search</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight break-all">
          @if (q()) {
            Results for "{{ q() }}"
          } @else {
            Search
          }
        </h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          Cross-entity fan-out across products, orders, customers and CMS pages.
        </p>
      </header>

      <form
        class="flex items-center gap-3 flex-wrap"
        role="search"
        (submit)="submit($event)"
        data-testid="search-form"
      >
        <input
          #queryInput
          type="search"
          name="q"
          aria-label="Search query"
          [value]="q()"
          placeholder="Search…"
          class="flex-1 min-w-[16rem] min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        />
        <button
          type="submit"
          class="inline-flex h-11 items-center bg-surface-emphasis text-on-emphasis px-4 text-xs tracking-widest uppercase hover:bg-surface-emphasis-hover focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="search-submit"
        >
          Search
        </button>
      </form>

      <div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by type">
        @for (opt of typeOptions; track opt.value) {
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 min-h-[44px] border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="typeFilter() === opt.value"
            [class.text-ink]="typeFilter() === opt.value"
            [class.border-line]="typeFilter() !== opt.value"
            [class.text-ink-muted]="typeFilter() !== opt.value"
            [attr.aria-pressed]="typeFilter() === opt.value"
            [attr.data-testid]="'search-type-' + (opt.value ?? 'all')"
            (click)="setType(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <div role="alert" data-testid="search-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div
        role="status"
        [attr.aria-busy]="loading() ? 'true' : null"
        [attr.aria-label]="loading() ? 'Loading search results' : null"
        class="flex flex-col gap-4"
      >
        @if (loading()) {
          <app-skeleton height="2rem" width="30%" />
          <app-skeleton height="10rem" width="100%" />
        }
      </div>

      @if (!loading() && !q()) {
        <p class="tabular text-sm text-ink-muted">Enter a search term to see matching records.</p>
      } @else if (!loading() && result(); as r) {
        @if (totalHits() === 0) {
          <p class="tabular text-sm text-ink-muted" data-testid="search-empty">
            Nothing matched "{{ q() }}".
          </p>
        } @else {
          @for (group of visibleGroups(); track group.type) {
            <section
              class="flex flex-col gap-4 border border-line p-4"
              [attr.aria-labelledby]="'group-' + group.type"
              [attr.data-testid]="'search-group-' + group.type"
            >
              <header class="flex items-center justify-between gap-4 flex-wrap">
                <h2
                  [id]="'group-' + group.type"
                  class="text-xs tracking-widest uppercase text-ink-muted"
                >
                  {{ label(group.type) }}
                </h2>
                <app-badge tone="neutral" [ariaLabel]="group.total + ' total'">
                  {{ group.total }}
                </app-badge>
              </header>

              @if (group.items.length === 0) {
                <p class="tabular text-sm text-ink-muted">No matches in this group.</p>
              } @else {
                <ul class="flex flex-col" role="list">
                  @for (hit of group.items; track hit.id) {
                    <li class="border-b border-line last:border-b-0 py-3">
                      <a
                        [routerLink]="hit.url"
                        class="flex items-center justify-between gap-3 hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 -mx-2 px-2"
                        [attr.data-testid]="'search-hit-' + hit.id"
                      >
                        <span class="min-w-0 flex-1">
                          <span class="block tabular text-sm text-ink truncate">
                            {{ hit.title }}
                          </span>
                          @if (hit.subtitle) {
                            <span
                              class="block tabular text-xs text-ink-muted truncate"
                              data-testid="search-hit-subtitle"
                            >
                              {{ hit.subtitle }}
                            </span>
                          }
                        </span>
                      </a>
                    </li>
                  }
                </ul>

                @if (group.total > group.items.length) {
                  <p
                    class="tabular text-xs text-ink-muted"
                    aria-live="polite"
                    [attr.data-testid]="'search-group-truncation-' + group.type"
                  >
                    Showing {{ group.items.length }} of {{ group.total }}.
                    @if (viewAllRoute(group.type); as route) {
                      <a
                        [routerLink]="route"
                        [queryParams]="{ search: q() }"
                        class="text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        View all in {{ label(group.type) }}
                      </a>
                    }
                  </p>
                }
              }
            </section>
          }
        }
      }
    </section>
  `,
})
export class SearchResultsPage implements OnInit, OnDestroy {
  private readonly service = inject(GlobalSearchService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<GlobalSearchResult | null>(null);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly q = computed(() => (this.queryParams()['q'] ?? '').trim());
  readonly typeFilter = computed<GlobalSearchType | null>(() => {
    const raw = this.queryParams()['type'];
    return ALL_TYPES.includes(raw as GlobalSearchType) ? (raw as GlobalSearchType) : null;
  });

  readonly visibleGroups = computed<readonly GlobalSearchGroup[]>(() => {
    const groups = this.result()?.groups ?? [];
    const t = this.typeFilter();
    return t ? groups.filter((g) => g.type === t) : groups;
  });

  readonly totalHits = computed(() =>
    (this.result()?.groups ?? []).reduce((sum, g) => sum + g.total, 0),
  );

  readonly typeOptions: ReadonlyArray<{ value: GlobalSearchType | null; label: string }> = [
    { value: null, label: 'All' },
    { value: 'product', label: 'Products' },
    { value: 'order', label: 'Orders' },
    { value: 'customer', label: 'Customers' },
    { value: 'cms', label: 'CMS' },
  ];

  protected label(type: GlobalSearchType): string {
    return TYPE_LABELS[type];
  }

  /**
   * Where a truncated group sends the operator for the full set. `cms` has no
   * target on purpose: the CMS admin list has no `search` param, so a link
   * would drop the query and strand them (plan D, K5).
   */
  protected viewAllRoute(type: GlobalSearchType): string | null {
    return VIEW_ALL_ROUTES[type];
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.elements.namedItem('q') as HTMLInputElement | null;
    const q = input?.value.trim() ?? '';
    if (!q) return;
    void this.router.navigate(['/search'], { queryParams: { q, type: this.typeFilter() } });
  }

  setType(value: GlobalSearchType | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { type: value },
      queryParamsHandling: 'merge',
    });
  }

  private fetch(): void {
    const q = this.q();
    if (!q || q.length < 2) {
      this.result.set(null);
      return;
    }
    const type = this.typeFilter();
    this.loading.set(true);
    this.error.set(null);
    this.service
      .search({ q, limit: 20, ...(type ? { types: [type] } : {}) })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to search.';
    if (err instanceof ApiNotFoundError) return 'Search service unavailable. Try again.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Search failed. Try again.';
  }
}
