import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  LoadErrorComponent,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import {
  SeoService,
  type ListSeoSubmissionsQuery,
  type SeoAnalytics,
  type SeoCoverage,
  type SeoQuota,
  type SeoSubmission,
  type SeoSubmissionEngine,
  type SeoSubmissionTrigger,
  type SubmissionHealth,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  SEO_SUBMIT_DIALOG_DESC_ID,
  SEO_SUBMIT_DIALOG_TITLE_ID,
  SeoSubmitDialogComponent,
  type SeoSubmitDialogData,
  type SeoSubmitDialogResult,
  summarizeSeoSubmit,
} from './seo-submit.dialog';
import { SeoStatusStripComponent } from './seo-status-strip.component';
import { SeoCoverageCardComponent } from './seo-coverage-card.component';
import { SeoQuotaReadoutComponent } from './seo-quota-readout.component';
import { SeoPerformanceBlockComponent } from './seo-performance-block.component';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

type EngineFilter = 'ALL' | SeoSubmissionEngine;
type TriggerFilter = 'ALL' | SeoSubmissionTrigger;
type OutcomeFilter = 'ALL' | 'OK' | 'FAILED';

const engineLabel: Record<SeoSubmissionEngine, string> = {
  indexnow: 'IndexNow',
  gsc: 'Google',
  bing: 'Bing',
};

@Component({
  selector: 'app-seo-submissions-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    LoadErrorComponent,
    SkeletonComponent,
    SeoStatusStripComponent,
    SeoCoverageCardComponent,
    SeoQuotaReadoutComponent,
    SeoPerformanceBlockComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="seo-submissions-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/seo/redirects" class="hover:underline">SEO</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">Indexing</span>
      </nav>

      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">SEO</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Indexing</h1>
          <p class="mt-3 text-sm text-ink-muted">
            How Google and Bing have received the catalogue, the quota you have to spend, and the
            audit trail of every submission — manual, on-publish, and scheduled.
          </p>
        </div>
        @if (canManage()) {
          <app-button
            variant="primary"
            (clicked)="openResubmitDialog()"
            data-testid="seo-indexing-resubmit-sitemap"
          >
            Resubmit sitemap
          </app-button>
        }
      </header>

      <p
        class="text-sm text-ink min-h-[1.5rem]"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="seo-submit-result"
      >
        {{ result() || ' ' }}
      </p>

      <!-- Monitoring dashboard (DR-17 D3): status strip → coverage → quota. -->
      <div class="flex flex-col gap-6">
        @if (monitoringError()) {
          <app-load-error
            [message]="monitoringError()!"
            [compact]="true"
            [retrying]="monitoringRetrying()"
            retryLabel="monitoring panels"
            testId="seo-monitoring-degraded"
            (retry)="reloadMonitoring()"
          />
        }
        <app-seo-status-strip
          [health]="health()"
          [loading]="healthLoading()"
          [canManage]="canManage()"
          [rechecking]="rechecking()"
          (recheck)="onRecheck()"
        />
        <div class="grid gap-6 lg:grid-cols-2">
          <app-seo-coverage-card [coverage]="coverage()" [loading]="coverageLoading()" />
          <app-seo-quota-readout [quota]="quota()" [loading]="quotaLoading()" />
        </div>
        <app-seo-performance-block [analytics]="analytics()" [loading]="analyticsLoading()" />
      </div>

      <h2 class="text-xs tracking-widest uppercase text-ink-muted font-normal">
        Submission history
      </h2>

      <div class="flex items-start gap-8 flex-wrap">
        <div class="flex items-center gap-3 flex-wrap" role="group" aria-label="Filter by engine">
          <span class="text-xs tracking-widest uppercase text-ink-muted" aria-hidden="true"
            >Engine</span
          >
          @for (opt of engineOptions; track opt.value) {
            <button
              type="button"
              class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [class.border-ink]="engineFilter() === opt.value"
              [class.text-ink]="engineFilter() === opt.value"
              [class.border-line]="engineFilter() !== opt.value"
              [class.text-ink-muted]="engineFilter() !== opt.value"
              [attr.aria-pressed]="engineFilter() === opt.value"
              [attr.data-testid]="'seo-sub-engine-' + opt.value"
              (click)="setParam('engine', opt.value === 'ALL' ? null : opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>

        <div class="flex items-center gap-3 flex-wrap" role="group" aria-label="Filter by trigger">
          <span class="text-xs tracking-widest uppercase text-ink-muted" aria-hidden="true"
            >Trigger</span
          >
          @for (opt of triggerOptions; track opt.value) {
            <button
              type="button"
              class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [class.border-ink]="triggerFilter() === opt.value"
              [class.text-ink]="triggerFilter() === opt.value"
              [class.border-line]="triggerFilter() !== opt.value"
              [class.text-ink-muted]="triggerFilter() !== opt.value"
              [attr.aria-pressed]="triggerFilter() === opt.value"
              [attr.data-testid]="'seo-sub-trigger-' + opt.value"
              (click)="setParam('trigger', opt.value === 'ALL' ? null : opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>

        <div class="flex items-center gap-3 flex-wrap" role="group" aria-label="Filter by outcome">
          <span class="text-xs tracking-widest uppercase text-ink-muted" aria-hidden="true"
            >Outcome</span
          >
          @for (opt of outcomeOptions; track opt.value) {
            <button
              type="button"
              class="min-h-[44px] text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [class.border-ink]="outcomeFilter() === opt.value"
              [class.text-ink]="outcomeFilter() === opt.value"
              [class.border-line]="outcomeFilter() !== opt.value"
              [class.text-ink-muted]="outcomeFilter() !== opt.value"
              [attr.aria-pressed]="outcomeFilter() === opt.value"
              [attr.data-testid]="'seo-sub-outcome-' + opt.value"
              (click)="setOutcome(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>
      </div>

      @if (error()) {
        <p
          class="text-xs p-3 border border-status-error text-ink"
          role="alert"
          aria-atomic="true"
          data-testid="seo-submissions-error"
        >
          {{ error() }}
        </p>
      }

      <p role="status" aria-live="polite" class="sr-only">
        {{ loading() ? 'Loading indexing submissions…' : '' }}
      </p>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              SEO submission history
            </caption>
            <thead class="border-b border-line">
              <tr class="text-start">
                @for (col of columns; track col) {
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    {{ col }}
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of skeletonRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of columns; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    [attr.colspan]="columns.length"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="seo-submissions-empty"
                  >
                    No indexing requests yet.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'seo-submission-row-' + item.id"
                  >
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums whitespace-nowrap">
                      {{ item.createdAt | adminDate }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted tracking-widest uppercase">
                      {{ item.trigger }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink">
                      <span class="text-ink-muted">{{ item.targetType }}</span>
                      <span class="font-mono break-all ms-2">{{ item.targetRef }}</span>
                    </td>
                    <td class="px-4 py-3 text-xs text-ink">
                      {{ engineName(item.engine) }}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2 flex-wrap">
                        <app-badge
                          [tone]="item.accepted ? 'success' : 'error'"
                          [ariaLabel]="'Outcome: ' + (item.accepted ? 'accepted' : 'failed')"
                        >
                          {{ item.accepted ? 'OK' : 'Failed' }}
                        </app-badge>
                        <span class="text-xs text-ink-muted tabular-nums">
                          {{ item.submittedCount }}/{{ item.requestedCount }}
                          @if (item.skippedDeduped > 0) {
                            · {{ item.skippedDeduped }} deduped
                          }
                        </span>
                        @if (item.reason) {
                          <span class="text-xs text-ink-muted break-all">— {{ item.reason }}</span>
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
        testIdPrefix="seo-submissions"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class SeoSubmissionsPage implements OnInit, OnDestroy {
  private readonly seoService = inject(SeoService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStore);
  private readonly dialog = inject(Dialog);
  private readonly destroy$ = new Subject<void>();
  private resultTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5];
  protected readonly columns = ['Time', 'Trigger', 'Target', 'Engine', 'Result'];
  protected readonly engineName = (e: SeoSubmissionEngine) => engineLabel[e];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly SeoSubmission[]>([]);
  readonly total = signal(0);
  readonly result = signal<string | null>(null);

  // Monitoring dashboard state (DR-17 D3).
  readonly health = signal<SubmissionHealth | null>(null);
  readonly healthLoading = signal(true);
  readonly monitoringError = signal<string | null>(null);
  readonly monitoringRetrying = signal(false);
  readonly coverage = signal<SeoCoverage | null>(null);
  readonly coverageLoading = signal(true);
  readonly quota = signal<SeoQuota | null>(null);
  readonly quotaLoading = signal(true);
  readonly analytics = signal<SeoAnalytics | null>(null);
  readonly analyticsLoading = signal(true);
  readonly rechecking = signal(false);

  canManage(): boolean {
    return this.auth.hasAnyPermission(['seo:manage']);
  }

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly engineFilter = computed<EngineFilter>(() => {
    const raw = this.queryParams()['engine'];
    return raw === 'indexnow' || raw === 'gsc' || raw === 'bing' ? raw : 'ALL';
  });
  readonly triggerFilter = computed<TriggerFilter>(() => {
    const raw = this.queryParams()['trigger'];
    return raw === 'manual' || raw === 'auto-regen' || raw === 'cron' ? raw : 'ALL';
  });
  readonly outcomeFilter = computed<OutcomeFilter>(() => {
    const raw = this.queryParams()['accepted'];
    if (raw === 'true') return 'OK';
    if (raw === 'false') return 'FAILED';
    return 'ALL';
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly engineOptions: { value: EngineFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'indexnow', label: 'IndexNow' },
    { value: 'gsc', label: 'Google' },
    { value: 'bing', label: 'Bing' },
  ];
  readonly triggerOptions: { value: TriggerFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'manual', label: 'Manual' },
    { value: 'auto-regen', label: 'On publish' },
    { value: 'cron', label: 'Scheduled' },
  ];
  readonly outcomeOptions: { value: OutcomeFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'OK', label: 'Accepted' },
    { value: 'FAILED', label: 'Failed' },
  ];

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
    this.fetchHealth();
    this.fetchCoverage();
    this.fetchQuota();
    this.fetchAnalytics();
  }

  ngOnDestroy(): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  openResubmitDialog(): void {
    const data: SeoSubmitDialogData = {
      title: 'Resubmit sitemap',
      description:
        'Resubmits the whole sitemap to Google and Bing so they re-crawl the catalogue. This does not change any content.',
      confirmLabel: 'Resubmit sitemap',
      request: { sitemap: true },
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
      this.fetch();
    });
  }

  private announce(message: string): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.result.set(message);
    this.resultTimer = setTimeout(() => this.result.set(null), 6000);
  }

  // ── Monitoring dashboard (DR-17 D3) ─────────────────────────────────────────

  /**
   * Each panel renders its own empty placeholder on failure, which is
   * indistinguishable from "nothing to report". One notice above the block
   * says the readouts are incomplete and offers a retry.
   */
  private noteMonitoringFailure(): void {
    this.monitoringError.set('Some monitoring readouts could not be loaded.');
    this.monitoringRetrying.set(false);
  }

  reloadMonitoring(): void {
    this.monitoringError.set(null);
    this.monitoringRetrying.set(true);
    this.fetchHealth();
    this.fetchCoverage();
    this.fetchQuota();
    this.fetchAnalytics();
  }

  private fetchHealth(): void {
    this.healthLoading.set(true);
    this.seoService
      .getSubmissionHealth()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (h) => {
          this.health.set(h);
          this.healthLoading.set(false);
        },
        error: () => {
          this.healthLoading.set(false);
          this.noteMonitoringFailure();
        },
      });
  }

  private fetchCoverage(): void {
    this.coverageLoading.set(true);
    this.seoService
      .getCoverage()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (c) => {
          this.coverage.set(c);
          this.coverageLoading.set(false);
        },
        error: () => {
          this.coverageLoading.set(false);
          this.noteMonitoringFailure();
        },
      });
  }

  private fetchQuota(): void {
    this.quotaLoading.set(true);
    this.seoService
      .getQuota()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (q) => {
          this.quota.set(q);
          this.quotaLoading.set(false);
        },
        error: () => {
          this.quotaLoading.set(false);
          this.noteMonitoringFailure();
        },
      });
  }

  private fetchAnalytics(): void {
    this.analyticsLoading.set(true);
    this.seoService
      .getAnalytics()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (a) => {
          this.analytics.set(a);
          this.analyticsLoading.set(false);
        },
        error: () => {
          this.analyticsLoading.set(false);
          this.noteMonitoringFailure();
        },
      });
  }

  onRecheck(): void {
    if (this.rechecking()) return;
    this.rechecking.set(true);
    this.seoService
      .recheckHealth()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (h) => {
          this.health.set(h);
          this.rechecking.set(false);
          this.announce('Submission health re-checked.');
        },
        error: (err: unknown) => {
          this.rechecking.set(false);
          this.announce(this.formatRecheckError(err));
        },
      });
  }

  private formatRecheckError(err: unknown): string {
    if (err instanceof ApiError && err.status === 429)
      return 'Re-check is rate-limited (1 per 5 minutes). Please try again shortly.';
    return 'Could not re-check submission health. Please retry.';
  }

  setParam(key: 'engine' | 'trigger', value: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value, page: null },
      queryParamsHandling: 'merge',
    });
  }

  setOutcome(value: OutcomeFilter): void {
    const accepted = value === 'OK' ? 'true' : value === 'FAILED' ? 'false' : null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { accepted, page: null },
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

  private fetch(): void {
    const query: ListSeoSubmissionsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };
    const engine = this.engineFilter();
    if (engine !== 'ALL') query.engine = engine;
    const trigger = this.triggerFilter();
    if (trigger !== 'ALL') query.trigger = trigger;
    const outcome = this.outcomeFilter();
    if (outcome === 'OK') query.accepted = true;
    if (outcome === 'FAILED') query.accepted = false;

    this.loading.set(true);
    this.error.set(null);
    this.seoService
      .listSubmissions(query)
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
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to view indexing submissions.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load indexing submissions. Please retry.';
  }
}
