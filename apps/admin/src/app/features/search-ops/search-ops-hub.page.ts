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
import { ButtonComponent, LoadErrorComponent, SkeletonComponent } from '@admin-ui';
import { ApiError } from '@admin-types';
import { SearchAdminService } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';

type ReindexStatus = { tone: 'success' | 'error'; message: string } | null;

@Component({
  selector: 'app-search-ops-hub-page',
  standalone: true,
  imports: [RouterLink, ButtonComponent, LoadErrorComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="search-ops-hub">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Search ops</h1>
        <p class="mt-3 text-sm text-ink-muted">
          Synonyms, merchandising rules, zero-result queries, and the full-catalogue re-index.
        </p>
      </header>

      @if (countsError()) {
        <app-load-error
          [message]="countsError()!"
          [compact]="true"
          [retrying]="loading()"
          retryLabel="search-ops counts"
          testId="search-ops-counts-degraded"
          (retry)="fetchCounts()"
        />
      }

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <a
          routerLink="/search-ops/synonyms"
          aria-label="Manage synonym groups"
          class="border border-line bg-surface p-6 flex flex-col gap-3 hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="search-ops-card-synonyms"
        >
          <h2 class="text-xs tracking-widest uppercase text-ink-muted font-normal">Synonyms</h2>
          <div class="flex items-end gap-3">
            @if (loading()) {
              <app-skeleton height="2rem" width="5rem" />
            } @else {
              <p class="text-4xl font-mono font-bold tabular-nums">{{ synonymCount() }}</p>
              <p class="text-sm text-ink-muted">groups</p>
            }
          </div>
          <p class="text-sm text-ink-muted">
            Term groups expand user queries to match adjacent vocabulary.
          </p>
          <p class="text-xs tracking-widest uppercase text-ink mt-auto">
            Manage synonyms <span aria-hidden="true">→</span>
          </p>
        </a>

        <a
          routerLink="/search-ops/merchandising"
          aria-label="Manage merchandising rules"
          class="border border-line bg-surface p-6 flex flex-col gap-3 hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="search-ops-card-merchandising"
        >
          <h2 class="text-xs tracking-widest uppercase text-ink-muted font-normal">
            Merchandising rules
          </h2>
          <div class="flex items-end gap-3">
            @if (loading()) {
              <app-skeleton height="2rem" width="5rem" />
            } @else {
              <p class="text-4xl font-mono font-bold tabular-nums">{{ ruleCount() }}</p>
              <p class="text-sm text-ink-muted">rules</p>
            }
          </div>
          <p class="text-sm text-ink-muted">
            Boost, bury, pin, or redirect products in the search ranking pipeline.
          </p>
          <p class="text-xs tracking-widest uppercase text-ink mt-auto">
            Manage rules <span aria-hidden="true">→</span>
          </p>
        </a>

        <a
          routerLink="/search-ops/zero-results"
          aria-label="View zero-result queries"
          class="border border-line bg-surface p-6 flex flex-col gap-3 hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="search-ops-card-zero-results"
        >
          <h2 class="text-xs tracking-widest uppercase text-ink-muted font-normal">
            Zero-result queries
          </h2>
          <div class="flex items-end gap-3">
            @if (loading()) {
              <app-skeleton height="2rem" width="5rem" />
            } @else {
              <p class="text-4xl font-mono font-bold tabular-nums">{{ zeroResultCount() }}</p>
              <p class="text-sm text-ink-muted">in last 30 days</p>
            }
          </div>
          <p class="text-sm text-ink-muted">
            Queries that returned no results — close catalogue or naming gaps.
          </p>
          <p class="text-xs tracking-widest uppercase text-ink mt-auto">
            View zero results <span aria-hidden="true">→</span>
          </p>
        </a>

        <section
          class="border border-line bg-surface p-6 flex flex-col gap-4"
          data-testid="search-ops-card-reindex"
          aria-labelledby="reindex-title"
        >
          <div>
            <p class="text-xs tracking-widest uppercase text-ink-muted">Re-index</p>
            <h2 id="reindex-title" class="mt-1 text-lg font-bold">Re-build the search index</h2>
          </div>
          <p class="text-sm text-ink-muted">
            Re-runs the search index over every active product. Safe to trigger during business
            hours.
          </p>
          <div class="mt-auto flex items-center justify-end">
            @if (canReindex()) {
              <app-button
                (clicked)="triggerReindex()"
                [loading]="reindexing()"
                [disabled]="reindexing()"
                data-testid="search-ops-reindex-button"
              >
                Re-index catalog
              </app-button>
            } @else {
              <p class="text-xs text-ink-muted">
                Requires the <span class="font-mono">products:manage</span> permission.
              </p>
            }
          </div>
          <p
            class="text-xs"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="search-ops-reindex-status"
            [class.border]="!!status()"
            [class.p-3]="!!status()"
            [class.border-status-success]="status()?.tone === 'success'"
            [class.border-status-error]="status()?.tone === 'error'"
            [class.text-ink]="!!status()"
          >
            {{ status()?.message ?? '' }}
          </p>
        </section>
      </div>
    </section>
  `,
})
export class SearchOpsHubPage implements OnInit, OnDestroy {
  private readonly search = inject(SearchAdminService);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly countsError = signal<string | null>(null);
  readonly synonymCount = signal(0);
  readonly ruleCount = signal(0);
  readonly zeroResultCount = signal(0);
  readonly reindexing = signal(false);
  readonly status = signal<ReindexStatus>(null);

  readonly canReindex = computed(() => this.auth.hasPermission('products:manage'));

  ngOnInit(): void {
    this.fetchCounts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  triggerReindex(): void {
    if (this.reindexing()) return;
    this.reindexing.set(true);
    this.status.set(null);
    this.search
      .reindex()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.reindexing.set(false);
          this.status.set({
            tone: 'success',
            message: `Re-index queued (${res.reindexed} products)`,
          });
        },
        error: (err: unknown) => {
          this.reindexing.set(false);
          this.status.set({ tone: 'error', message: this.formatError(err) });
        },
      });
  }

  fetchCounts(): void {
    this.loading.set(true);
    this.countsError.set(null);
    let remaining = 3;
    const done = () => {
      remaining -= 1;
      if (remaining === 0) this.loading.set(false);
    };
    // A count that never arrives renders as 0, which reads as "nothing here"
    // rather than "we could not ask".
    const failed = () => {
      this.countsError.set('Some counts could not be loaded and may read as zero.');
      done();
    };
    this.search
      .listSynonyms({ page: 1, pageSize: 1 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.synonymCount.set(res.meta.total);
          done();
        },
        error: () => failed(),
      });
    this.search
      .listMerchandisingRules({ page: 1, pageSize: 1 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.ruleCount.set(res.meta.total);
          done();
        },
        error: () => failed(),
      });
    this.search
      .zeroResults({ period: 30, page: 1, pageSize: 1 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.zeroResultCount.set(res.meta.total);
          done();
        },
        error: () => failed(),
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiError && err.message) return err.message;
    return 'Failed to queue re-index';
  }
}
