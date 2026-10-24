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
import { AuditLogService, type AuditLogEntry, type ListAuditLogQuery } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import {
  actionLabel,
  actorLabel,
  actorName,
  diffEntry,
  formatDiffValue,
  resourceLabel,
  type DiffRow,
} from './audit-logs.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

/**
 * `/audit-logs` — tamper-evident action log viewer.
 *
 * URL owns page + pageSize + filters (userId, entityType, action,
 * from, to) so deep-links are shareable to the security team. Row
 * expand renders a before/after diff via `diffEntry` — we never show
 * the raw JSON blob because operators typically only need the moved
 * fields.
 */
@Component({
  selector: 'app-audit-logs-page',
  standalone: true,
  imports: [ButtonComponent, RouterLink, SkeletonComponent, AdminDatePipe, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="audit-logs-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Security</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Audit logs</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Every admin action. Filter by actor, resource, or date range to isolate a specific change;
          expand a row for the before/after diff.
        </p>
      </header>

      <form
        role="search"
        aria-label="Filter audit logs"
        class="grid grid-cols-1 md:grid-cols-4 gap-4"
      >
        <div class="flex flex-col gap-1">
          <label for="audit-actor" class="text-xs tracking-widest uppercase text-ink-muted">
            Actor
          </label>
          <input
            id="audit-actor"
            type="text"
            inputmode="text"
            autocomplete="off"
            placeholder="name, email, or 'system'"
            aria-describedby="audit-actor-hint"
            class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [value]="actorFilter()"
            (input)="onFilterInput('actor', $event)"
            data-testid="audit-filter-actor"
          />
          <p id="audit-actor-hint" class="text-xs text-ink-muted">
            Search the names shown in the Actor column.
          </p>
        </div>
        <div class="flex flex-col gap-1">
          <label for="audit-entity" class="text-xs tracking-widest uppercase text-ink-muted">
            Resource type
          </label>
          <input
            id="audit-entity"
            type="text"
            autocomplete="off"
            placeholder="e.g. product, order, promotion"
            class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [value]="entityTypeFilter()"
            (input)="onFilterInput('entityType', $event)"
            data-testid="audit-filter-entityType"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label for="audit-action" class="text-xs tracking-widest uppercase text-ink-muted">
            Action
          </label>
          <input
            id="audit-action"
            type="text"
            autocomplete="off"
            placeholder="e.g. update, deactivate"
            class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [value]="actionFilter()"
            (input)="onFilterInput('action', $event)"
            data-testid="audit-filter-action"
          />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1">
            <label for="audit-from" class="text-xs tracking-widest uppercase text-ink-muted">
              From
            </label>
            <input
              id="audit-from"
              type="datetime-local"
              class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [value]="fromFilter()"
              (change)="onRangeChange('from', $event)"
              data-testid="audit-filter-from"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="audit-to" class="text-xs tracking-widest uppercase text-ink-muted">
              To
            </label>
            <input
              id="audit-to"
              type="datetime-local"
              class="w-full min-h-[44px] px-3 py-2 text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [value]="toFilter()"
              (change)="onRangeChange('to', $event)"
              data-testid="audit-filter-to"
            />
          </div>
        </div>
      </form>

      @if (userIdFilter()) {
        <div
          class="flex items-center gap-3 border border-line p-3 text-xs"
          data-testid="audit-userid-chip"
        >
          <span class="text-ink-muted">Filtered to one actor id</span>
          <span class="font-mono text-ink">{{ truncateId(userIdFilter()) }}</span>
          <span class="sr-only">{{ userIdFilter() }}</span>
          <app-button
            variant="ghost"
            size="sm"
            (clicked)="clearUserIdFilter()"
            testId="audit-userid-clear"
            ariaLabel="Clear the actor id filter"
          >
            Clear
          </app-button>
        </div>
      }

      <div data-testid="audit-logs-error">
        @if (error()) {
          <p role="alert" class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Audit log entries
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 w-10"
                >
                  <span class="sr-only">Expand</span>
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Time
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Actor
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Action
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Resource
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Correlation
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of [0, 1, 2, 3, 4, 5]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td colspan="6" class="px-4 py-16 text-center text-ink-muted text-sm">
                    No audit entries match the current filters.
                  </td>
                </tr>
              } @else {
                @for (row of rows(); track row.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'audit-row-' + row.id"
                  >
                    <td class="px-4 py-3">
                      <button
                        type="button"
                        class="w-8 h-8 inline-flex items-center justify-center text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                        [attr.aria-expanded]="isExpanded(row.id)"
                        [attr.aria-controls]="'audit-diff-' + row.id"
                        [attr.aria-label]="
                          (isExpanded(row.id) ? 'Collapse ' : 'Expand ') + 'audit entry'
                        "
                        (click)="toggleRow(row.id)"
                        [attr.data-testid]="'audit-toggle-' + row.id"
                      >
                        <span aria-hidden="true">{{ isExpanded(row.id) ? '▾' : '▸' }}</span>
                      </button>
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-ink">
                      {{ row.createdAt | adminDate: 'forensic' }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted" [title]="row.userId ?? ''">
                      {{ actorName(row) }}
                    </td>
                    <td class="px-4 py-3 text-sm text-ink">
                      {{ actionLabel(row.action) }}
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted">
                      @if (row.entityId) {
                        <a
                          [routerLink]="['/audit-logs', row.entityType, row.entityId]"
                          class="inline-flex items-center gap-2 text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                          [attr.aria-label]="
                            'Drill down to ' +
                            resourceLabel(row.entityType) +
                            ' ' +
                            row.entityId +
                            ' audit entries'
                          "
                          [attr.data-testid]="'audit-row-link-' + row.id"
                        >
                          <span>{{ resourceLabel(row.entityType) }}</span>
                          <span class="font-mono text-ink-muted" [title]="row.entityId">{{
                            truncateId(row.entityId)
                          }}</span>
                          <span class="sr-only">{{ row.entityId }}</span>
                        </a>
                      } @else {
                        <span class="text-ink">{{ resourceLabel(row.entityType) }}</span>
                      }
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-ink-muted">
                      @if (row.correlationId) {
                        <span aria-hidden="true">{{ truncateId(row.correlationId) }}</span>
                        <span class="sr-only">{{ row.correlationId }}</span>
                      } @else {
                        —
                      }
                    </td>
                  </tr>
                  @if (isExpanded(row.id)) {
                    <tr
                      [id]="'audit-diff-' + row.id"
                      class="border-b border-line bg-surface-elevated"
                      [attr.data-testid]="'audit-diff-' + row.id"
                    >
                      <td></td>
                      <td colspan="5" class="px-4 py-3">
                        @if (diffRows(row).length === 0) {
                          <p class="text-xs text-ink-muted">
                            No field-level diff available for this entry.
                          </p>
                        } @else {
                          <ul class="flex flex-col gap-1" role="list">
                            @for (d of diffRows(row); track d.key) {
                              <li class="grid grid-cols-[1fr_1fr_1fr] gap-3 font-mono text-xs">
                                <span class="text-ink">{{ d.key }}</span>
                                <span class="text-ink border-l-2 border-status-error pl-2">
                                  <span class="sr-only">Before: </span>
                                  {{ format(d.before) }}
                                </span>
                                <span class="text-ink border-l-2 border-status-success pl-2">
                                  <span class="sr-only">After: </span>
                                  {{ format(d.after) }}
                                </span>
                              </li>
                            }
                          </ul>
                        }
                      </td>
                    </tr>
                  }
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
        testIdPrefix="audit-logs"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class AuditLogsPage implements OnInit, OnDestroy {
  private readonly service = inject(AuditLogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();
  private readonly filterInput$ = new Subject<{ key: string; value: string }>();

  protected readonly placeholderRows = [0, 1, 2, 3, 4];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly AuditLogEntry[]>([]);
  readonly total = signal(0);
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly userIdFilter = computed(() => this.queryParams()['userId'] ?? '');
  readonly actorFilter = computed(() => this.queryParams()['actor'] ?? '');
  readonly entityTypeFilter = computed(() => this.queryParams()['entityType'] ?? '');
  readonly actionFilter = computed(() => this.queryParams()['action'] ?? '');
  readonly fromFilter = computed(() => this.queryParams()['from'] ?? '');
  readonly toFilter = computed(() => this.queryParams()['to'] ?? '');
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly actionLabel = actionLabel;
  protected readonly actor = actorLabel;
  protected readonly actorName = actorName;
  protected readonly format = formatDiffValue;
  protected readonly resourceLabel = resourceLabel;

  truncateId(id: string): string {
    return id.length > 14 ? id.slice(0, 14) + '…' : id;
  }

  diffRows(row: AuditLogEntry): DiffRow[] {
    return diffEntry(row);
  }

  ngOnInit(): void {
    this.filterInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => a.key === b.key && a.value === b.value),
        takeUntil(this.destroy$),
      )
      .subscribe(({ key, value }) => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { [key]: value || null, page: null },
          queryParamsHandling: 'merge',
        });
      });
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFilterInput(key: 'userId' | 'actor' | 'entityType' | 'action', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.filterInput$.next({ key, value });
  }

  /**
   * The `userId` filter has no input of its own, so a bookmarked URL would
   * otherwise narrow the log with nothing on screen to say so.
   */
  clearUserIdFilter(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { userId: null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  onRangeChange(key: 'from' | 'to', event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const iso = raw ? new Date(raw).toISOString() : null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: iso, page: null },
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

  isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  toggleRow(id: string): void {
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded.set(next);
  }

  private fetch(): void {
    const query: ListAuditLogQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    // No input writes `userId` any more; it stays honoured so a bookmarked or
    // hand-built URL keeps working.
    if (this.userIdFilter()) query.userId = this.userIdFilter();
    if (this.actorFilter()) query.actor = this.actorFilter();
    if (this.entityTypeFilter()) query.entityType = this.entityTypeFilter();
    if (this.actionFilter()) query.action = this.actionFilter();
    if (this.fromFilter()) query.from = this.fromFilter();
    if (this.toFilter()) query.to = this.toFilter();

    this.loading.set(true);
    this.error.set(null);
    this.service
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
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to view the audit log.';
    if (err instanceof ApiNotFoundError) return 'Audit log entry not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load audit log.';
  }
}
